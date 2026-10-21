import { TestFunction, test, expect } from "vitest";
import { randInt } from "../../src/utils/randomNumber";
import arrayEquals from "../../src/utils/arrayEquals";

const ARRAY_TEST_COUNT = 1_000;
const MIN_ARR_LENGTH = 50;
const MAX_ARR_LENGTH = 500;
const MIN_ARR_VALUE = Number.MIN_SAFE_INTEGER;
const MAX_ARR_VALUE = Number.MAX_SAFE_INTEGER;
const MIN_ARR_DEPTH = 1;
const MAX_ARR_DEPTH = 10;

// TODO: find out if floating-point arrays can work with this function, or if the values must first be clamped to work properly (e.g., using Float number wrapper)

const testArrays: TestFunction = function(context) {
    for (let i=0; i<ARRAY_TEST_COUNT; i++) {
        const randomValues = Boolean(randInt(0, 1));
        const randomLengths = Boolean(randInt(0, 1));
        const randomDepths = Boolean(randInt(0, 1));
        const [arr1, arr2] = createArrayPair(
            randomValues,
            randomLengths,
            randomDepths
        ) as [ArrayLike<Number>, ArrayLike<Number>];

        if (!randomLengths) {
            expect(arr1.length).toBe(arr2.length);
        }

        const checkArrEquality = function<Arr extends ArrayLike<Number | Arr>>(array1: Arr, array2: Arr): boolean {
            if (array1.length !== array2.length) {
                return false;
            }

            for (let j=0; j<array1.length; j++) {
                const it1 = array1[j];
                const it2 = array2[j];
                if (hasIterator(it1) && hasIterator(it2)) {
                    if (!checkArrEquality(it1 as Arr, it2 as Arr)) {
                        return false;
                    }
                } else if (it1 !== it2) {
                    return false;
                }
            }
            return true;
        }

        const condition = arrayEquals(arr1, arr2);
        const expected = checkArrEquality(arr1, arr2);
        const msg = `randomValues: ${randomValues} - randomLengths: ${randomLengths} - randomDepths: ${randomDepths}\n`+
            `${JSON.stringify(arr1)}\n`+
            `${JSON.stringify(arr2)}\n`+
            `${condition} -> ${expected}\n`;
        // console.log(msg);
        
        expect(condition).toBe(expected);
    }
}

test(testArrays, testArrays);

function hasIterator(obj: Object): boolean {
    return Object.getOwnPropertySymbols(Object.getPrototypeOf(obj)).includes(Symbol.iterator);
}

function createArrayPair<Arr extends Array<Number | Arr>>(randomValues: boolean, randomLengths: boolean, randomDepths: boolean): [Arr, Arr] {
    if (MIN_ARR_LENGTH < 1) {
        throw new Error("MIN_ARR_LENGTH smaller than 1");
    }
    if (MIN_ARR_DEPTH < 1) {
        throw new Error("MIN_ARR_DEPTH smaller than 1");
    }
    const invalidLengths = MIN_ARR_LENGTH > MAX_ARR_LENGTH;
    const invalidValues = MIN_ARR_VALUE >= MAX_ARR_VALUE;
    const invalidDepths = MIN_ARR_DEPTH > MAX_ARR_DEPTH;
    if (invalidLengths || invalidValues || invalidDepths) {
        throw new Error(
            `Invalid testing condition variables set: `+
            `${invalidLengths ? `Lengths(${MIN_ARR_LENGTH}, ${MAX_ARR_LENGTH})` : ""} `+
            `${invalidValues ? `Values(${MIN_ARR_VALUE}, ${MAX_ARR_VALUE})` : ""} `+
            `${invalidDepths ? `Values(${MIN_ARR_DEPTH}, ${MAX_ARR_DEPTH})` : ""}`
        );
    }

    const arr1 = new Array(
        randInt(MIN_ARR_LENGTH, MAX_ARR_LENGTH)
    ).fill(null) as Arr;
    
    const arr2 = new Array(
        randomLengths
        ? randInt(MIN_ARR_LENGTH, MAX_ARR_LENGTH)
        : arr1.length
    ).fill(null) as Arr;

    for (let i=0; i<arr1.length; i++) {
        arr1[i] = randInt(MIN_ARR_VALUE, MAX_ARR_VALUE);
    }

    for (let i=0; i<arr2.length; i++) {
        arr2[i] = randomValues ? randInt(MIN_ARR_VALUE, MAX_ARR_VALUE) : arr1[i];
    }

    return [arr1, arr2];
}