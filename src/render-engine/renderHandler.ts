import { Float32 } from "../utils/numberWrappers";
import arrayEquals from "../utils/arrayEquals";
import { WgslReflect, ResourceType } from "wgsl_reflect";
import glUniWriter from "./glUniformWriter";
import AudioDataManager, { Process, ProcessInfo } from "../analyser/AudioDataManager";
import AbQueue from "../utils/ArrayBufferQueue";
import commonShaderCode from "../common.wgsl?raw";
import fftShaderCode from "../analyser/fft.wgsl?raw";
import renderShaderCode from "./render.wgsl?raw";

export type RenderFnState = {
    commonReflect: WgslReflect,
    tsQuerySet: GPUQuerySet,
    bufs: ReturnType<typeof createReqBuffers>,
    lyts: ReturnType<typeof createReqLayouts>,
    grps: ReturnType<typeof createReqGroups>,
    pipes: ReturnType<typeof createReqPipelines>,
    sampAbQueue: AbQueue,
    sampChanged: boolean,
    logs: {
        lastLogTs: number
    },
    lastFFTSize: number,
};

export const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("Failed to retrieve GPU Adapter");

const tsQueryEnabled = adapter.features.has("timestamp-query");
if (!tsQueryEnabled) {
    console.warn("Timestamp query is not supported");
} else {
    console.log("Timestamp query is supported");
}

export const device = await adapter.requestDevice({
    requiredFeatures: [
        (tsQueryEnabled ? "timestamp-query" : null)
    ].filter((value) => value !== "" && value !== null) as GPUFeatureName[]
});

export let sab: SharedArrayBuffer | null = null;
export let ctx: GPUCanvasContext | null = null;

/**
 * @param buf 
 * @param canvas 
 * @returns Render function
 */
export function init(
    buf: SharedArrayBuffer,
    canvas: OffscreenCanvas
): RenderFnState {
    sab = buf;

    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!navigator.gpu) {
        throw new Error("WebGPU not supported");
    } else if (context === null) {
        throw new Error("Failed to get webgpu context from canvas");
    }
    ctx = context;

    ctx.configure({
        device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: "premultiplied"
    });
    console.log("WebGPU canvas configured");

    const renderState = prepRenderer();
    return renderState;
}

function prepRenderer() {
    const fftShaderModCode = `${commonShaderCode}\n\n${fftShaderCode}`;
    const fftShaderMod = device.createShaderModule({
        code: fftShaderModCode
    });
    const renderShaderModCode = `${commonShaderCode}\n\n${renderShaderCode}`;
    const renderShaderMod = device.createShaderModule({
        code: renderShaderModCode
    });
    Promise.all([
        fftShaderMod.getCompilationInfo(),
        renderShaderMod.getCompilationInfo()
    ])
    .then((infos) => {
        console.info("shader module compilation info:");
        infos.forEach((info) => console.info(...info.messages));
    });

    const commonReflect = new WgslReflect(commonShaderCode);
    const commonShaderStatus = validateCommonShader(commonReflect);
    if (commonShaderStatus !== 0) {
        throw new Error(`${commonShaderStatus}`);
    }

    const tsQuerySet = device.createQuerySet({
        count: 8,
        type: "timestamp"
    });
    const bufs = createReqBuffers(commonReflect, tsQuerySet);
    const lyts = createReqLayouts();
    const grps = createReqGroups(bufs, lyts);
    const pipes = createReqPipelines(fftShaderMod, renderShaderMod, lyts);

    const maxFFTSize = 2 ** AudioDataManager.FFT_RATIO_MAX.value;
    const sampAbQueue = new AbQueue([new ArrayBuffer(maxFFTSize * Float32Array.BYTES_PER_ELEMENT)]);

    const startingRenderState: RenderFnState = {
        commonReflect,
        tsQuerySet,
        bufs,
        lyts,
        grps,
        pipes,
        sampAbQueue,
        sampChanged: true,
        logs: {
            lastLogTs: 0
        },
        lastFFTSize: 0,
    };

    return startingRenderState;
}

/**
 * Render to the WebGPU context. The state is passed in to allow the
 * render function to not have to be nested inside the prepRenderer() function,
 * improving readability and encapsulation of the code.
 * @param state 
 * @returns 
 */
export async function render<T extends RenderFnState>(state: T): Promise<T> {
    if (!sab) {
        console.error("Cannot begin rendering until the SharedArrayBuffer is set");
        return state;
    }

    // TODO: utilize an FFT hop size, so that I'm not recalculating FFT
    // every frame (hop size = sample rate * FFT update interval in seconds),
    // but rather maybe every 0.01s (10ms). This will cut down on
    // visually-redundant FFT computation.
    // Need to use Hann window function before FFT to reduce spectral leakage.
    // If wanting to combine channels' spectrums after FFT, use combined spectrum
    // with, for example, RMS/power combination
    const { commonReflect, tsQuerySet, bufs, lyts, grps, pipes, sampAbQueue, logs } = state;
    const minFFTRatio = AudioDataManager.FFT_RATIO_MIN.value;
    const maxFFTRatio = AudioDataManager.FFT_RATIO_MAX.value;
    const maxFFTSize = 2 ** maxFFTRatio;
    const oldSampBuf = sampAbQueue.dequeue();
    const man = new AudioDataManager(sab);
    const manHeader = man.getHeader("processHeadIndex", "fftRatio");
    if (manHeader.fftRatio < minFFTRatio || manHeader.fftRatio > maxFFTRatio) {
        console.warn(
            `FFT ratio out of valid range [${minFFTRatio}, ${maxFFTRatio}]: `+
            manHeader.fftRatio
        );
        manHeader.fftRatio = Math.min(
            Math.max(minFFTRatio, manHeader.fftRatio),
            maxFFTRatio
        );
    }
    const { processHeadIndex } = manHeader;

    const normalizeArr = (arr: Float32Array): void => {
        for (let i=0; i<arr.length; i++) {
            arr[i] = Float32.normalizeValue(arr[i]);
        }
    }
    const fftSize = 2 ** manHeader.fftRatio;
    // TODO: instead of always creating a new array from getSamples(), use 2
    // existing arraybuffers in the abQueue and input the back ab into
    // getSamples(), and only create a new ab if 2 abs don't already exist, or
    // the fft sizes change.
    const manSampBuf = man.getSamples(0, 0, fftSize, processHeadIndex, -1).buffer
        .transferToFixedLength(maxFFTSize * Float32Array.BYTES_PER_ELEMENT);
    normalizeArr(new Float32Array(manSampBuf));
    if (oldSampBuf !== undefined) {
        const oldSampArr = new Float32Array(oldSampBuf);
        const manSampArr = new Float32Array(manSampBuf);
        if (arrayEquals(oldSampArr, manSampArr)) {
            state.sampChanged = false;
            return state;
        }
        state.sampChanged = true;

        // FOR TESTING (interp should be implemented on the gpu, not cpu)
        for (let i=0; i<manSampArr.length; i++) {
            manSampArr[i] = cerp(oldSampArr[i], manSampArr[i], 0.45);
        }
    }
    device.queue.writeBuffer(
        bufs.audioSampBuf, 0,
        manSampBuf, 0,
        manSampBuf.byteLength
    );
    sampAbQueue.enqueue(manSampBuf);

    if (fftSize !== state.lastFFTSize) {
        const writerOut = glUniWriter(commonReflect, "fft.size", [fftSize]);
        device.queue.writeBuffer(
            bufs.glUniBuf,
            writerOut.gpuBufOffset,
            writerOut.byteData
        );
        writerOut.byteData.transferToFixedLength(0);
    }
    state.lastFFTSize = fftSize;

    const commandEncoder = device.createCommandEncoder();
    const wkgrpCt = Math.ceil(fftSize / 64);
    const preprocessPass = commandEncoder.beginComputePass({
        timestampWrites: {
            querySet: tsQuerySet,
            beginningOfPassWriteIndex: 0,
            endOfPassWriteIndex: 1
        }
    });
    preprocessPass.setPipeline(pipes.preprocSampPipe);
    preprocessPass.setBindGroup(0, grps.preprocSampGrp);
    preprocessPass.dispatchWorkgroups(wkgrpCt);
    preprocessPass.end();

    const alignment = device.limits.minUniformBufferOffsetAlignment;
    const stageStride = Math.ceil(4 / alignment) * alignment;
    const stageCt = Math.log2(fftSize);
    const bflyWkgrpCt = Math.ceil(fftSize / 2 / 64);
    const fftPass = commandEncoder.beginComputePass({
        timestampWrites: {
            querySet: tsQuerySet,
            beginningOfPassWriteIndex: 2,
            endOfPassWriteIndex: 3
        }
    });
    fftPass.setPipeline(pipes.compFFTPipe);
    for (let stage=0; stage<stageCt; stage++) {
        const fftGrp = stage % 2 === 0 ? grps.compFFTGrp : grps.compFFTPongGrp;
        fftPass.setBindGroup(0, fftGrp, [stage * stageStride]);
        fftPass.dispatchWorkgroups(bflyWkgrpCt);
    }
    fftPass.end();

    const magGrp = stageCt % 2 !== 0 ? grps.compMagGrp : grps.compMagPongGrp;
    const magnitudePass = commandEncoder.beginComputePass({
        timestampWrites: {
            querySet: tsQuerySet,
            beginningOfPassWriteIndex: 4,
            endOfPassWriteIndex: 5
        }
    });
    magnitudePass.setPipeline(pipes.compMagPipe);
    magnitudePass.setBindGroup(0, magGrp);
    magnitudePass.dispatchWorkgroups(wkgrpCt);
    magnitudePass.end();

    const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
            {
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
                view: ctx!.getCurrentTexture()
            }
        ],
        timestampWrites: {
            querySet: tsQuerySet,
            beginningOfPassWriteIndex: 6,
            endOfPassWriteIndex: 7
        }
    });
    renderPass.setPipeline(pipes.renderSampPipe);
    renderPass.setBindGroup(0, grps.renderSampGrp);
    renderPass.draw(6, fftSize / 2);
    renderPass.end();

    commandEncoder.resolveQuerySet(
        tsQuerySet,
        0,
        tsQuerySet.count,
        bufs.tsQuerySetBuf,
        0
    );
    commandEncoder.copyBufferToBuffer(bufs.tsQuerySetBuf, bufs.tsQuerySetReadBuf);
    device.queue.submit([commandEncoder.finish()]);

    return state;
}

// INTERP FUNCTIONS FOR TESTING
function lerp(a: number, b: number, t: number): number {
    return (b-a) * t + a;
}
function cerp(a: number, b: number, t: number): number {
    const t2 = (1 - Math.cos(t*Math.PI)) / 2;
    return a * (1 - t2) + b * t2;
}

/**
 * Logs the timestamps stored by the query set from the FFT and render shaders.
 * Some precision is lost when displaying in milliseconds, rather than nanoseconds
 * 
 * @param tsQuerySetReadBuf 
 * @param displayNs By default, displays timestamps in milliseconds, but
 * can choose to display in nanoseconds instead
 */
export async function getShaderTimestampLogs(
    tsQuerySetReadBuf: RenderFnState["bufs"]["tsQuerySetReadBuf"],
    displayNs = false
) {
    const readBufSize = tsQuerySetReadBuf.size;
    await tsQuerySetReadBuf.mapAsync(GPUMapMode.READ, 0, readBufSize);
    const tsAbCpy = tsQuerySetReadBuf.getMappedRange(0, readBufSize).slice();
    tsQuerySetReadBuf.unmap();

    const tsArr = new BigUint64Array(tsAbCpy);
    const divisor = displayNs ? 1n : BigInt(1e+6);
    const preprocT = (tsArr[1] - tsArr[0]) / divisor;
    const fftT = (tsArr[3] - tsArr[2]) / divisor;
    const magT = (tsArr[5] - tsArr[4]) / divisor;
    const renderT = (tsArr[7] - tsArr[6]) / divisor;
    tsAbCpy.transferToFixedLength(0);

    const getLblPrefix = (lbl: string) => lbl.substring(0, lbl.indexOf(":"));
    const padLblPrefix = (lbl: string, spaceCt: number) => {
        const colonI = lbl.indexOf(":");
        return (
            lbl.substring(0, colonI).padStart(spaceCt, " ") +
            lbl.substring(colonI)
        );
    };
    const tf = displayNs ? "ns" : "ms";
    const lbls = [
        `Preprocess: ${preprocT+tf}`,
        `FFT: ${fftT+tf}`,
        `Magnitude: ${magT+tf}`,
        `Render: ${renderT+tf}`
    ];

    const longestLblLen = lbls.reduce((prev, curr) => {
        return Math.max(prev, getLblPrefix(curr).length);
    }, getLblPrefix(lbls[0]).length);
    lbls.forEach((lbl, i) => lbls[i] = padLblPrefix(lbl, longestLblLen));
    const logContent = lbls.join("\n");

    return logContent;
}

function createReqBuffers(commonReflect: WgslReflect, tsQuerySet: GPUQuerySet) {
    const maxFFTSize = 2 ** AudioDataManager.FFT_RATIO_MAX.value;
    const glUniBufSize = commonReflect.findResource(0, 0).size;
    const glUniBuf = device.createBuffer({
        size: glUniBufSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: "global_uniform_buffer"
    });

    const audioSampBuf = device.createBuffer({
        size: maxFFTSize * 4,
        usage: GPUBufferUsage.STORAGE
            | GPUBufferUsage.COPY_DST
            | GPUBufferUsage.COPY_SRC,
        label: "audio_sample_buffer"
    });

    const compSampBuf = device.createBuffer({
        size: audioSampBuf.size * 2,
        usage: audioSampBuf.usage,
        label: "complex_sample_buffer"
    });

    const fftBuf = device.createBuffer({
        size: compSampBuf.size,
        usage: audioSampBuf.usage,
        label: "fft_buffer"
    });

    const alignment = device.limits.minUniformBufferOffsetAlignment;
    const stageStride = Math.ceil(4 / alignment) * alignment;
    const stageCt = Math.log2(maxFFTSize);
    const stageBuf = device.createBuffer({
        size: stageStride * stageCt,
        usage: glUniBuf.usage
    });
    for (let stage=0; stage<stageCt; stage++) {
        const value = new Uint32Array([stage]);
        // console.log(`Stage stride: ${stageStride}`);
        device.queue.writeBuffer(stageBuf, stage * stageStride, value);
    }

    const magBuf = device.createBuffer({
        size: audioSampBuf.size,
        usage: audioSampBuf.usage,
        label: "magnitude_buffer"
    });

    const tsQuerySetBuf = device.createBuffer({
        size: tsQuerySet.count * 8,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });
    const tsQuerySetReadBuf = device.createBuffer({
        size: tsQuerySetBuf.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    return {
        glUniBuf,
        audioSampBuf,
        compSampBuf,
        fftBuf,
        stageBuf,
        magBuf,
        tsQuerySetBuf,
        tsQuerySetReadBuf
    };
}

/**
 * Creates bind group layouts, NOT pipeline layouts
 * @returns 
 */
function createReqLayouts() {
    const preprocSampLyt = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "uniform"
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "read-only-storage"
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "storage"
                }
            }
        ]
    });
    const compFFTLyt = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "uniform"
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "read-only-storage"
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "storage"
                }
            },
            {
                binding: 3,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "uniform",
                    hasDynamicOffset: true
                }
            }
        ]
    });
    const compMagLyt = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "uniform"
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "read-only-storage"
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "storage"
                }
            }
        ]
    });
    const renderSampLyt = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "uniform"
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "read-only-storage"
                }
            }
        ]
    });

    return {
        preprocSampLyt,
        compFFTLyt,
        compMagLyt,
        renderSampLyt
    };
}

function createReqGroups(
    bufs: RenderFnState["bufs"],
    lyts: RenderFnState["lyts"]
) {
    const preprocSampGrp = device.createBindGroup({
        layout: lyts.preprocSampLyt,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: bufs.glUniBuf
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: bufs.audioSampBuf
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: bufs.compSampBuf
                }
            }
        ],
        label: "preprocessSamplesGroup"
    });
    const compFFTGrp = device.createBindGroup({
        layout: lyts.compFFTLyt,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: bufs.glUniBuf
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: bufs.compSampBuf
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: bufs.fftBuf
                }
            },
            {
                binding: 3,
                resource: {
                    buffer: bufs.stageBuf,
                    size: 4
                }
            }
        ],
        label: "computeFFTGroup"
    });
    const compFFTPongGrp = device.createBindGroup({
        layout: lyts.compFFTLyt,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: bufs.glUniBuf
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: bufs.compSampBuf
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: bufs.fftBuf
                }
            },
            {
                binding: 3,
                resource: {
                    buffer: bufs.stageBuf,
                    size: 4
                }
            }
        ],
        label: "computeFFTPongGroup"
    });
    const compMagGrp = device.createBindGroup({
        layout: lyts.compMagLyt,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: bufs.glUniBuf
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: bufs.fftBuf
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: bufs.magBuf
                }
            }
        ],
        label: "computeMagnitudeGroup"
    });
    const compMagPongGrp = device.createBindGroup({
        layout: lyts.compMagLyt,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: bufs.glUniBuf
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: bufs.compSampBuf
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: bufs.magBuf
                }
            }
        ],
        label: "computeMagnitudeGroup"
    });
    const renderSampGrp = device.createBindGroup({
        layout: lyts.renderSampLyt,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: bufs.glUniBuf
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: bufs.magBuf
                }
            }
        ]
    });

    return {
        preprocSampGrp,
        compFFTGrp,
        compFFTPongGrp,
        compMagGrp,
        compMagPongGrp,
        renderSampGrp
    };
}

function createReqPipelines(
    fftShader: GPUShaderModule,
    renderShader: GPUShaderModule,
    lyts: RenderFnState["lyts"]
) {
    const preprocSampPipe = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [lyts.preprocSampLyt]
        }),
        compute: {
            module: fftShader,
            entryPoint: "preprocess_samples"
        }
    });
    const compFFTPipe = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [lyts.compFFTLyt]
        }),
        compute: {
            module: fftShader,
            entryPoint: "fft_stage"
        }
    });
    const compMagPipe = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [lyts.compMagLyt]
        }),
        compute: {
            module: fftShader,
            entryPoint: "magnitude"
        }
    });
    const renderSampPipe = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [lyts.renderSampLyt]
        }),
        vertex: {
            module: renderShader,
            entryPoint: "vert_main"
        },
        fragment: {
            module: renderShader,
            entryPoint: "frag_main",
            targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
        },
        primitive: {
            topology: "triangle-list"
        }
    });

    return {
        preprocSampPipe,
        compFFTPipe,
        compMagPipe,
        renderSampPipe
    };
}

/**
 * Ensures conventions of the "common.wgsl" shader are preserved.
 * @param reflect 
 * @returns If valid, returns 0.
 */
function validateCommonShader(reflect: WgslReflect): number {
    const groups = reflect.getBindGroups();
    for (let i=0; i<groups.length; i++) {
        const glUniVarInfo = groups[i][0];
        if (!glUniVarInfo) continue;
        const prevGlUniVarInfo = groups[Math.max(0, i-1)][0];
        
        const glUniAccess = glUniVarInfo.access;
        if (glUniAccess !== "read") {
            console.error(
                `Access for global uniform variable must be unset (${glUniAccess})`
            );
            return 1;
        }

        const glUniRes = glUniVarInfo.resourceType;
        if (glUniRes !== ResourceType.Uniform) {
            console.error(
                `Resource type of global uniform variable must be`+
                `set to 'uniform' (${glUniRes})`
            );
            return 1;
        }

        const currTypeName = glUniVarInfo.type.getTypeName();
        const prevTypeName = prevGlUniVarInfo.type.getTypeName();
        if (currTypeName !== prevTypeName) {
            const prevGrpI = Math.max(0, i-1);
            console.error(
                `Type name of global uniform variable at @group(${i}) @binding(0) `+
                `does not match @group(${prevGrpI}): `+
                `${currTypeName} != ${prevTypeName}`
            );
            return 1;
        }

        // if (name !== "global_uniforms") {
        //     console.error(
        //         `Global uniform variable must be named "global_uniforms" (${name})`
        //     );
        //     return 1;
        // }
    }

    return 0;
}