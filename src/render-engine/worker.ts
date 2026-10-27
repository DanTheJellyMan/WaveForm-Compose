import AudioDataManager from "../analyser/AudioDataManager";
import strictObjectAssign from "../utils/strictObjectAssign";
import { RenderFnState, device, sab, init, render, getShaderTimestampLogs }
    from "./renderHandler";

export type WorkerInitData = {
    sab: SharedArrayBuffer,
    canvas: OffscreenCanvas
};

export type WorkerConfig = {
    fftRatio: number,
    fps: number
};

type ManagerHeaderConfig = Pick<
    WorkerConfig,
    keyof typeof AudioDataManager["HEADER_LAYOUT"] & keyof WorkerConfig
>;

export type WorkerMessagePayload =
{
    type: "init",
    data: WorkerInitData
} |
{
    type: "config-update",
    data: Partial<WorkerConfig> | Required<WorkerConfig>
} |
{
    type: "get-bitmap",
    data?: ImageBitmap
};

let config: WorkerConfig | null = null;
let renderState: RenderFnState | null = null;
let renderReqAnimFrameId: number = 0;
let renderIntId: number = 0;
let logIntMs = 5_000;

self.onmessage = handleMessage;
self.postMessage("Ready");

function handleMessage(e: MessageEvent<WorkerMessagePayload>): void {
    const { type, data } = e.data;

    switch(type) {
        case "init": {
            renderState = init(data.sab, data.canvas);
            break;
        }
        case "config-update": {
            if (config === null) {
                // Apply all options of new config
                const strictData = data as Required<WorkerConfig>;
                config = strictData;
            } else {
                // Apply only options that changed from
                // oldConfig to config (updated).
                const partialData = data as Partial<WorkerConfig>;
                strictObjectAssign(config, partialData);
            }
            if (!sab) return;
            
            type Entries<T> = [keyof T, T[keyof T]][];
            const manHdrConfigKeySet = new Set(Object.keys(config));
            const manHdrLytKeySet = new Set(
                Object.keys(AudioDataManager.HEADER_LAYOUT)
                .filter((hdrKey) => manHdrConfigKeySet.has(hdrKey))
            );
            const manHdrConfig = Object.fromEntries(
                (Object.entries(structuredClone(config)) as Entries<WorkerConfig>)
                .filter(([key]) => manHdrLytKeySet.has(key))
            ) as ManagerHeaderConfig;
            new AudioDataManager(sab).setHeader(manHdrConfig);

            handleRenderLoop(config.fps);
            break;
        }
        case "get-bitmap": {
            if (!device || !device.canvasContext) {
                console.error(
                    "Cannot retrieve ImageBitmap from rendering canvas - "+
                    "uninitialized canvas context"
                );
                return;
            }
            
            const bitmap = (device.canvasContext.canvas as OffscreenCanvas)
            .transferToImageBitmap();
            const messagePayload: WorkerMessagePayload = {
                type: "get-bitmap",
                data: bitmap
            };
            self.postMessage(messagePayload, [bitmap]);
        }
    }
}

function handleRenderLoop(fps: number) {
    cancelAnimationFrame(renderReqAnimFrameId);
    clearInterval(renderIntId);
    renderReqAnimFrameId = 0;
    renderIntId = 0;

    const logShaders = async (force = false) => {
        const { logs } = renderState!;
        const t = performance.now();
        if (force ||
            (renderState!.sampChanged && (t >= logs.lastLogTs + logIntMs))
        ) {
            // logs.lastLogTs = t;
            // const logContent = await getShaderTimestampLogs(
            //     renderState!.bufs.tsQuerySetReadBuf,
            //     true
            // );
            // console.log(logContent);
        }
    }

    if (fps === Infinity || fps === -Infinity) {
        // Render continuously at refresh rate with requestAnimationFrame()
        const loopFn = async (ts: DOMHighResTimeStamp) => {
            if (renderState) {
                await render(renderState);
                // await logShaders();
            }
            renderReqAnimFrameId = requestAnimationFrame(loopFn);
        };
        renderReqAnimFrameId = requestAnimationFrame(loopFn);
    } else if (fps < 0) {
        // Render a specific amount of frames at refresh rate
        const totalRenderCt = Math.abs(fps);
        let renderCt = 0;
        const loopFn = async (ts: DOMHighResTimeStamp) => {
            if (renderState) {
                if (renderCt >= totalRenderCt) return;
                renderCt++;
                await render(renderState);
                // await logShaders();
            }
            renderReqAnimFrameId = requestAnimationFrame(loopFn);
        };
        renderReqAnimFrameId = requestAnimationFrame(loopFn);
    } else if (fps > 0 && fps < Infinity) {
        // Render at a specified FPS from (0, Infinity)
        // Prevents beginning another render before the last one finishes
        let doneRendering = true;
        renderIntId = setInterval(async () => {
            if (renderState && doneRendering) {
                doneRendering = false;
                await render(renderState);
                // await logShaders();
                doneRendering = true;
            }
        }, 1000 / fps);
    }
    // fps = 0, cancels any future rendering
    // (essentially clears all rendering loops and doesn't start a new one)
}