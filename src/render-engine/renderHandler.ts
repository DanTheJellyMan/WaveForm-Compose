import { luma, UniformStore, UniformBlock, CompositeShaderType, Buffer } from "@luma.gl/core";
import { webgpuAdapter } from "@luma.gl/webgpu";
import {  } from "@luma.gl/shadertools";
import { Computation, Model } from "@luma.gl/engine";

import { MemberInfo, WgslReflect } from "wgsl_reflect";
import COMMON_SHADER_SRC from "../common.wgsl?raw";
import FFT_SHADER_SRC from "../analyser/fft.wgsl?raw";
import RENDER_SHADER_SRC from "./render.wgsl?raw";
const FFT_SHADER_FSRC = `${COMMON_SHADER_SRC}\n\n${FFT_SHADER_SRC}`;
const RENDER_SHADER_FSRC = `${COMMON_SHADER_SRC}\n\n${RENDER_SHADER_SRC}`;

import AudioDataManager, { Process, ProcessInfo } from "../analyser/AudioDataManager";
import AbQueue from "../utils/ArrayBufferQueue";
import { Float32 } from "../utils/numberWrappers";
import arrayEquals from "../utils/arrayEquals";

export type RenderFnState = ReturnType<typeof prepRenderer>;

if (!webgpuAdapter.isSupported()) {
    throw new Error("WebGPU adapter is not supported");
}

export const device = await luma.createDevice({
    type: "webgpu",
    adapters: [webgpuAdapter],
    featureLevel: "max",
    powerPreference: "high-performance"
});

// TODO: timestamp query sets cannot be created if this is false, so
// handle that behavior in the code.
const tsQueryEnabled = device.features.has("timestamp-query");
if (!tsQueryEnabled) {
    console.warn("Timestamp query is not supported");
} else {
    console.info("Timestamp query is supported");
}

export let sab: SharedArrayBuffer | null = null;

/**
 * @param buf 
 * @param canvas 
 * @returns
 */
export function init(
    buf: SharedArrayBuffer,
    canvas: OffscreenCanvas
): RenderFnState {
    if (sab) {
        throw new Error("Already initialized render handler");
    }

    sab = buf;
    device.canvasContext = device.createCanvasContext({
        canvas,
        alphaMode: "premultiplied"
    });
    console.log("Canvas context created");

    const renderState = prepRenderer();
    return renderState;
}

function prepRenderer() {
    const commonReflect = new WgslReflect(COMMON_SHADER_SRC);
    const glUniParsedTypes = parseStructType(commonReflect, "GlobalUniforms");
    if (!glUniParsedTypes) {
        throw new Error(
            `GlobalUniforms struct doesn't exist in common shader:\n`+
            COMMON_SHADER_SRC
        );
    }
    const glUniStore = new UniformStore(device, {
        gl_uniforms: {
            layout: "wgsl-uniform",
            uniformTypes: glUniParsedTypes
        }
    });
    const tsQuerySet = device.createQuerySet({
        count: 8,
        type: "timestamp"
    });
    
    const MAX_FFT_SIZE = 2 ** AudioDataManager.FFT_RATIO_MAX.value;
    const glUniBuf = glUniStore.getManagedUniformBuffer("gl_uniforms");
    const audioSampBuf = device.createBuffer({
        byteLength: MAX_FFT_SIZE * Float32.BYTES,
        usage: Buffer.STORAGE | Buffer.COPY_DST | Buffer.COPY_SRC
    });
    const complexSampBuf = device.createBuffer({
        byteLength: audioSampBuf.byteLength * 2,
        usage: audioSampBuf.usage
    });
    const fftBuf = device.createBuffer({
        byteLength: complexSampBuf.byteLength,
        usage: audioSampBuf.usage
    });

    const stageAlign = device.limits.minUniformBufferOffsetAlignment;
    const stageCt = Math.log2(MAX_FFT_SIZE);
    const stageUniBuf = device.createBuffer({
        byteLength: stageAlign * stageCt,
        usage: glUniBuf.usage
    });
    for (let stage=0; stage<stageCt; stage++) {
        const value = new Uint32Array([stage]);
        stageUniBuf.write(value.buffer, stage * stageAlign);
    }

    const magBuf = device.createBuffer({
        byteLength: audioSampBuf.byteLength,
        usage: audioSampBuf.usage
    });

    const preprocSampComp = new Computation(device, {
        source: FFT_SHADER_FSRC,
        entryPoint: "preproc_samps",
        shaderLayout: {
            bindings: [
                {
                    name: "gl_uniforms",
                    type: "uniform",
                    group: 0,
                    location: 0
                },
                {
                    name: "audio_samps",
                    type: "read-only-storage",
                    group: 0,
                    location: 1
                },
                {
                    name: "complex_samps",
                    type: "storage",
                    group: 0,
                    location: 2
                }
            ]
        },
        bindings: {
            gl_uniforms: { buffer: glUniBuf },
            audio_samps: { buffer: audioSampBuf },
            complex_samps: { buffer: complexSampBuf }
        }
    });
    const compFFTComp = new Computation(device, {
        source: FFT_SHADER_FSRC,
        entryPoint: "fft_stage",
        shaderLayout: {
            bindings: [
                {
                    name: "gl_uniforms",
                    type: "uniform",
                    group: 0,
                    location: 0
                },
                {
                    name: "fft_in",
                    type: "read-only-storage",
                    group: 1,
                    location: 1
                },
                {
                    name: "fft_out",
                    type: "storage",
                    group: 1,
                    location: 2
                },
                {
                    name: "stage_uni",
                    type: "uniform",
                    group: 1,
                    location: 3
                }
            ]
        },
        bindings: {
            gl_uniforms: { buffer: glUniBuf },
            fft_in: { buffer: complexSampBuf },
            fft_out: { buffer: fftBuf },
            stage_uni: { buffer: stageUniBuf }
        }
    });
    const compMagComp = new Computation(device, {
        source: FFT_SHADER_FSRC,
        entryPoint: "comp_mag",
        shaderLayout: {
            bindings: [
                {
                    name: "gl_uniforms",
                    type: "uniform",
                    group: 0,
                    location: 0
                },
                {
                    name: "mag_in",
                    type: "read-only-storage",
                    group: 2,
                    location: 1
                },
                {
                    name: "mag_out",
                    type: "storage",
                    group: 2,
                    location: 2
                }
            ]
        },
        bindings: {
            gl_uniforms: { buffer: glUniBuf },
            mag_in: { buffer: fftBuf },
            mag_out: { buffer: magBuf }
        }
    });

    const sampAbQueue = new AbQueue();
    const renderModel = new Model(device, {
        source: RENDER_SHADER_FSRC,
        vertexEntryPoint: "vert_main",
        fragmentEntryPoint: "frag_main",
        vertexCount: 6,
        bindings: {
            gl_uniforms: { buffer: glUniBuf },
            samps_db: { buffer: magBuf }
        }
    });
    
    return {
        commonReflect,
        sampChanged: true,
        lastFFTSize: 0,
        logs: {
            lastLogTs: 0
        },
        glUniStore,
        tsQuerySet,
        bufs: {
            audioSampBuf,
            complexSampBuf,
            fftBuf,
            stageUniBuf,
            magBuf
        },
        comps: {
            preprocSampComp,
            compFFTComp,
            compMagComp
        },
        sampAbQueue,
        models: {
            renderModel
        }
    };
}

function parseStructType(
    reflect: WgslReflect,
    structN: string
): Record<string, CompositeShaderType> | null {
    const objType = {};
    const structInfo = reflect.getStructInfo(structN);
    if (!structInfo) {
        return null;
    }

    const queue = [[objType, structInfo.name, structInfo.members]];
    while (queue.length > 0) {
        const [ parentObj, memN, submems ] = queue.shift()! as
            [Record<string, CompositeShaderType>, string, MemberInfo[]];

        for (const submem of submems) {
            const submemN = submem.name;
            const submemMems = submem.members;

            if (!submemMems) {
                parentObj[submemN] = submem.type.getTypeName() as
                    CompositeShaderType;
            } else {
                const submemObj = {};
                parentObj[submemN] = submemObj;
                queue.unshift([submemObj, submemN, submemMems]);
            }
        }
    }

    return objType;
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
        console.error(
            "Cannot begin rendering until the SharedArrayBuffer is set"
        );
        return state;
    }

    // TODO: utilize an FFT hop size, so that I'm not recalculating FFT
    // every frame (hop size = sample rate * FFT update interval in seconds),
    // but rather maybe every 0.01s (10ms). This will cut down on
    // visually-redundant FFT computation.
    // Need to use Hann window function before FFT to reduce spectral leakage.
    // If wanting to combine channels' spectrums after FFT, use combined spectrum
    // with, for example, RMS/power combination
    const { commonReflect, logs, glUniStore, tsQuerySet, bufs, comps, sampAbQueue, models } = state;
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

    const fftSize = 2 ** manHeader.fftRatio;
    // TODO: instead of always creating a new array from getSamples(), use 2
    // existing arraybuffers in the abQueue and input the back ab into
    // getSamples(), and only create a new ab if 2 abs don't already exist, or
    // the fft sizes change.
    const manSampBuf = man.getSamples(0, 0, fftSize, processHeadIndex, -1)
    .buffer
    .transferToFixedLength(maxFFTSize * Float32Array.BYTES_PER_ELEMENT);

    if (oldSampBuf !== undefined) {
        const oldSampArr = new Float32Array(oldSampBuf)
        const manSampArr = new Float32Array(manSampBuf)
        // .map((val) => Float32.normalizeValue(val));
        // TODO: fix array comparisons never equaling true when audio is paused, and
        // the jittering during playback when manSampArr is normalized
        if (arrayEquals(oldSampArr, manSampArr)) {
            sampAbQueue.enqueue(manSampBuf);
            state.sampChanged = false;
            return state;
        }
        state.sampChanged = true;

        // FOR TESTING (interp should be implemented on the gpu, not cpu)
        for (let i=0; i<manSampArr.length; i++) {
            manSampArr[i] = cerp(oldSampArr[i], manSampArr[i], 0.45);
        }
    }
    bufs.audioSampBuf.write(manSampBuf);
    sampAbQueue.enqueue(manSampBuf);

    const t = man.getHeader("currentTime").currentTime;
    glUniStore.setUniforms({
        gl_uniforms: {
            fft: { size: fftSize },
            render: {
                audio_t: man.getHeader("currentTime").currentTime,
                runtime_t: performance.now(),
                date_t: Date.now()
            }
        }
    })
    state.lastFFTSize = fftSize;

    const cmdEncoder = device.createCommandEncoder();
    const wkgrpCt = Math.ceil(fftSize / 64);
    comps.preprocSampComp.predraw(cmdEncoder);
    const preprocPass = cmdEncoder.beginComputePass({
        timestampQuerySet: tsQuerySet,
        beginTimestampIndex: 0,
        endTimestampIndex: 1
    });
    comps.preprocSampComp.dispatch(preprocPass, wkgrpCt);
    preprocPass.end();

    const stageAlign = device.limits.minUniformBufferOffsetAlignment;
    const stageCt = Math.log2(fftSize);
    const bflyWkgrpCt = Math.ceil(fftSize / 2 / 64);
    comps.compFFTComp.predraw(cmdEncoder);
    const fftPass = cmdEncoder.beginComputePass({
        timestampQuerySet: tsQuerySet,
        beginTimestampIndex: 2,
        endTimestampIndex: 3
    });
    for (let stage=0; stage<stageCt; stage++) {
        const inBuf = stage % 2 === 0 ? bufs.complexSampBuf : bufs.fftBuf;
        const outBuf = stage % 2 === 0 ? bufs.fftBuf : bufs.complexSampBuf;
        comps.compFFTComp.setBindings({
            fft_in: { buffer: inBuf },
            fft_out: { buffer: outBuf },
            stage_uni: {
                buffer: bufs.stageUniBuf,
                offset: stage * stageAlign,
                size: 4
            }
        });
        comps.compFFTComp.dispatch(fftPass, bflyWkgrpCt);
    }
    fftPass.end();

    comps.compMagComp.predraw(cmdEncoder);
    const magPass = cmdEncoder.beginComputePass({
        timestampQuerySet: tsQuerySet,
        beginTimestampIndex: 4,
        endTimestampIndex: 5
    });
    if (stageCt % 2 === 0) {
        comps.compMagComp.setBindings({
            mag_in: { buffer: bufs.complexSampBuf },
            mag_out: { buffer: bufs.magBuf }
        });
    } else {
        comps.compMagComp.setBindings({
            mag_in: { buffer: bufs.fftBuf },
            mag_out: { buffer: bufs.magBuf }
        });
    }
    comps.compMagComp.dispatch(magPass, wkgrpCt);
    magPass.end();

    models.renderModel.predraw(cmdEncoder);
    const renderPass = cmdEncoder.beginRenderPass({
        clearColor: [0,0,0,1],
        timestampQuerySet: tsQuerySet,
        beginTimestampIndex: 6,
        endTimestampIndex: 7
    });
    models.renderModel.setVertexCount(6);
    models.renderModel.setInstanceCount(fftSize / 2);
    models.renderModel.draw(renderPass);
    renderPass.end();
    device.submit(cmdEncoder.finish());

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
    tsQuerySet: RenderFnState["tsQuerySet"],
    displayNs = false
) {
    // TODO: update this function and the documentation
    return;
    // const readBufSize = tsQuerySetReadBuf.size;
    // await tsQuerySetReadBuf.mapAsync(GPUMapMode.READ, 0, readBufSize);
    // const tsAbCpy = tsQuerySetReadBuf.getMappedRange(0, readBufSize).slice();
    // tsQuerySetReadBuf.unmap();

    // const tsArr = new BigUint64Array(tsAbCpy);
    // const divisor = displayNs ? 1n : BigInt(1e+6);
    // const preprocT = (tsArr[1] - tsArr[0]) / divisor;
    // const fftT = (tsArr[3] - tsArr[2]) / divisor;
    // const magT = (tsArr[5] - tsArr[4]) / divisor;
    // const renderT = (tsArr[7] - tsArr[6]) / divisor;
    // tsAbCpy.transferToFixedLength(0);

    // const getLblPrefix = (lbl: string) => lbl.substring(0, lbl.indexOf(":"));
    // const padLblPrefix = (lbl: string, spaceCt: number) => {
    //     const colonI = lbl.indexOf(":");
    //     return (
    //         lbl.substring(0, colonI).padStart(spaceCt, " ") +
    //         lbl.substring(colonI)
    //     );
    // };
    // const tf = displayNs ? "ns" : "ms";
    // const lbls = [
    //     `Preprocess: ${preprocT+tf}`,
    //     `FFT: ${fftT+tf}`,
    //     `Magnitude: ${magT+tf}`,
    //     `Render: ${renderT+tf}`
    // ];

    // const longestLblLen = lbls.reduce((prev, curr) => {
    //     return Math.max(prev, getLblPrefix(curr).length);
    // }, getLblPrefix(lbls[0]).length);
    // lbls.forEach((lbl, i) => lbls[i] = padLblPrefix(lbl, longestLblLen));
    // const logContent = lbls.join("\n");

    // return logContent;
}