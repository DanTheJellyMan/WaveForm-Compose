import { TestFunction, test, expect } from "vitest";
import { randInt, randFloat } from "../../src/utils/randomNumber";
import { NumberWrapperTypes, Int8, Int16, Int32, Int64, Uint8, Uint16, Uint32, Uint64, Float16, Float32, Float64 } from "../../src/utils/numberWrappers";

const NUMBER_TEST_COUNT = 1_000;
console.log(`Number wrapper test iterations: ${NUMBER_TEST_COUNT}`);

const testNumberWrapper = function(Wrapper: NumberWrapperTypes) {
    const { MIN, MAX } = Wrapper;
    const values: number[] = new Array(NUMBER_TEST_COUNT).fill(null);

    switch(Wrapper) {
        case Float16:
        case Float32:
        case Float64:
            values.forEach((_, i) => values[i] = randFloat(Number(MIN), Number(MAX)));
            break;
        default:
            values.forEach((_, i) => values[i] = randInt(Number(MIN), Number(MAX)));
            break;
    }

    for (let i=0; i<values.length; i++) {
        expect(new Wrapper(values[i]).value).toBe(Wrapper.normalizeValue(values[i] as never));
    }
}

test(Int32, () => testNumberWrapper(Int32));
test(Uint32, () => testNumberWrapper(Uint32));
test(Float16, () => testNumberWrapper(Float16));