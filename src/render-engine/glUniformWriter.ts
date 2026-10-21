import { WgslReflect, VariableInfo, MemberInfo } from "wgsl_reflect";

export type NestedArray<T> = T | NestedArray<T>[];
export type NumberFormat = "Int8" | "Int16" | "Int32" | "Int64" | "Uint8" | "Uint16" | "Uint32" | "BigUint64" | "Float16" | "Float32" | "Float64";
export type OutputData = {
    byteData: ArrayBuffer,
    gpuBufOffset: number,
    numFormat: NumberFormat
};

/* Outline of how writer works:
    Starting from the GlobalUniforms struct, search through each member according
    to the given target member name (dot separated) to find what data type needs
    to be set into the GPU buffer (f32, u32, etc.).

    If target member is scalar, simply write the single value for it in the view.

    If target member is a vector or matrix, set all the inputted values correctly
    formatted in the view.

    If target member is another struct, recursively go through each member until
    there is no longer a struct and begin setting the corresponding input values
    in the view. Must also accomodate for alignment.
*/

/**
 * Determines where and how the inputted data should be written into the GPUBuffer
 * for the common shader's global uniform. This function does not modify any data
 * @param commonReflect 
 * @param tMemN The name of the target member to modify in the uniform
 * @param values 
 * @returns 
 */
export default function glUniformWriter(
    commonReflect: WgslReflect,
    tMemN: string,
    values: number[]
): OutputData {
    const glUni = commonReflect.uniforms
    .find((uni) => uni.type.name === "GlobalUniforms");
    if (glUni === undefined) {
        throw new Error("Could not find global uniform from common shader");
    }

    const tMemArr = tMemN.split(".");
    let nextGlUniMem: MemberInfo | typeof glUni = glUni;
    let tMemArrI = 0;
    let tMemInfo: MemberInfo | undefined;
    let gpuBufOffset = 0;

    while(tMemArrI < tMemArr.length) {
        const tMemIt = tMemArr[tMemArrI];
        const glUniMems: MemberInfo[] = nextGlUniMem.members!;
        const next = glUniMems.find((mem) => mem.name === tMemIt);
        if (!next) break;

        nextGlUniMem = next;
        gpuBufOffset += nextGlUniMem.offset
        tMemArrI++;
    }
    if (tMemArrI !== tMemArr.length) {
        throw new Error(`Could not find member of global uniform ${tMemN}`);
    }
    tMemInfo = nextGlUniMem as MemberInfo;

    const tMemNumFormat = getNumberFormat(tMemInfo.type);
    let view: DataView;
    if (tMemNumFormat !== "") {
        const viewByteLen = getNumberFormatByteLength(tMemNumFormat);
        view = new DataView(
            new ArrayBuffer(viewByteLen, { maxByteLength: viewByteLen })
        );
        const viewSetter = view[`set${tMemNumFormat}`];
        viewSetter(0, values[0], true);
    } else {
        const typeN = tMemInfo.type.name;
        const isVec = typeN === "vec";
        const matC = parseInt(typeN.charAt(3));
        const matR = parseInt(typeN.charAt(5));
        const isMat = typeN.substring(0,3) === "mat" &&
            typeN.charAt(4) === "x" && (
                !isNaN(matC) &&
                !isNaN(matR)
            );
        
        let align: number;
        if (isVec || isMat) {

            if (isMat) {

            }

            const format = tMemInfo.format!;
            console.log(format);
        } else if (tMemInfo.type.isStruct) {
            // console.log(tMemInfo);
            // const dvSetFnInfo = getDataViewSetFn();
        }
    }

    return {
        byteData: view.buffer,
        gpuBufOffset,
        numFormat
    };
}

function getNumberFormat(
    memTypeInfo: Exclude<MemberInfo["type"] | MemberInfo["format"], null>
) {
    let numFormat: NumberFormat | "";

    switch(memTypeInfo.name) {
        case "f32":
            numFormat = "Float32";
            break;
        case "i32":
            numFormat = "Int32";
            break;
        case "u32":
            numFormat = "Uint32";
            break;
        default:
            numFormat = "";
    }

    return numFormat;
}

function getNumberFormatByteLength(numFormat: NumberFormat): number {
    const bitLenStr = numFormat.substring(numFormat.indexOf("t", 2));
    return Math.round(parseInt(bitLenStr) / 8);
}
