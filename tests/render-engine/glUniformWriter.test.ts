/// <reference types="@webgpu/types" />
import { TestFunction, test, expect } from "vitest";
import { TypedArray } from "../../src/utils/types";
import glUniWriter, { NestedArray, getDataViewSetFn } from "../../src/render-engine/glUniformWriter";
import { WgslReflect } from "wgsl_reflect";

const TEST_SHADER_CODE = `
struct GlobalUniforms {
    mem1: SimpleStruct,
    mem2: SimpleStruct,
    // mem3: u32,
    // mem4: ComplexStruct
}
    
struct SimpleStruct {
    my_signed: i32,
    my_float: f32
}

struct ComplexStruct {
    my_pos: vec3<f32>
}

@group(0) @binding(0)
var<uniform> common: GlobalUniforms;
`;
const testReflect = new WgslReflect(TEST_SHADER_CODE);

const testUniforms: TestFunction = async function(context) {
    const setup = await setupWGPUInst();
    if (!setup) {
        throw new Error(`Failed to init WGPU`);
    }
    const { adapter, device, commonInfo, uniBuf, mapBuf } = setup;
    const values: NestedArray<number | bigint> = [69.420, 10];

    for (let i=0; i<values.length; i++) {
        const value = values[i];
        const depth = 21; // Typescript maximum
        const flatValue = value.constructor === Array
        ? value.flat(depth) as (number | bigint)[]
        : [value as number | bigint];
        const writerOut = glUniWriter(testReflect, `mem${i+1}`, flatValue);

        device.queue.writeBuffer(
            uniBuf,
            writerOut.gpuBufOffset,
            writerOut.byteData
        );
        device.queue.writeBuffer(
            mapBuf,
            writerOut.gpuBufOffset,
            writerOut.byteData
        );

        await mapBuf.mapAsync(
            GPUMapMode.READ,
            writerOut.gpuBufOffset,
            writerOut.byteData.byteLength
        );
        const abCpy = mapBuf.getMappedRange(
            writerOut.gpuBufOffset,
            writerOut.byteData.byteLength
        ).slice();
        mapBuf.unmap();

        const arrConstN = `${writerOut.numFormat}Array` as keyof typeof globalThis;
        const arrConst = globalThis[arrConstN] as new(ab:ArrayBuffer)=>TypedArray;
        const abValueArr = new arrConst(abCpy);
        expect(abValueArr.length).toBe(flatValue.length);
        
        for (let j=0; j<abValueArr.length; j++) {
            const abValue = abValueArr[j];
            const ogValue = flatValue[j];
            
            if (typeof abValue === "bigint" && typeof ogValue === "bigint") {
                expect(abValue).toBe(ogValue);
            } else if (typeof abValue === "number" && typeof ogValue === "number") {
                expect(abValue).toBeCloseTo(ogValue, 3);
            } else {
                throw new Error(
                    `Read value from buffer does not match type of`+
                    `original value: (Read: ${abValue}, OG: ${ogValue})`
                );
            }
        }
    }
};

test(testUniforms, testUniforms);

async function setupWGPUInst() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;

    const device = await adapter.requestDevice();
    const commonInfo = testReflect.findResource(0, 0);
    const uniBuf = device.createBuffer({
        size: commonInfo.size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const mapBuf = device.createBuffer({
        size: uniBuf.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    return { adapter, device, commonInfo, uniBuf, mapBuf };
}