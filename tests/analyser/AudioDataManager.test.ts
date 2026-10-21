import { TestFunction, test, expect } from "vitest";
import stringifyArrays from "../../src/utils/stringifyArray";
import { randInt, randFloat } from "../../src/utils/randomNumber";
import arrayEquals from "../../src/utils/arrayEquals";
import { Float32 } from "../../src/utils/numberWrappers";
import AudioDataManager, { Process } from "../../src/analyser/AudioDataManager";

const RANDOM_TESTING = false as const;
const MANAGER_CONFIG = getManagerConfig(RANDOM_TESTING);

const bufSize = AudioDataManager.estimateBufSize(
    MANAGER_CONFIG.inputCount,
    MANAGER_CONFIG.maxChannelCount
); // TODO: investigate why the test gets frozen when modifying this value
console.log(`Buffer byte length: ${bufSize}`);

const buf = new ArrayBuffer(bufSize);
const manager = new AudioDataManager(buf);
manager.initHeader(
    MANAGER_CONFIG.sampleRate,
    MANAGER_CONFIG.fftRatio
);

const testHeader: TestFunction = function(context) {
    const headerValues = manager.getHeader("sampleRate", "fftRatio", "processHeadIndex", "currentFrame", "currentTime", "previousConsumeFrame");
    
    expect(headerValues.sampleRate).toBe(MANAGER_CONFIG.sampleRate);
    expect(headerValues.fftRatio).toBe(MANAGER_CONFIG.fftRatio);
    expect(headerValues.processHeadIndex).toBe(0);
    expect(headerValues.currentFrame).toBe(0n);
    expect(headerValues.currentTime).toBe(0);
    expect(headerValues.previousConsumeFrame).toBe(0n);
}

const testSampleReadWrite: TestFunction = function(context) {
    console.log(`Manager config: ${JSON.stringify(MANAGER_CONFIG, null, 4)}`);
    
    const { randomTesting, sampleFrameLength, inputCount, maxChannelCount } = MANAGER_CONFIG;
    const requiredProcessCount = estimateRequiredProcesses(MANAGER_CONFIG);
    const inputProcesses: Process[] = new Array(requiredProcessCount)
    .fill(null)
    .map(() => new Array(inputCount)
        .fill(null)
        .map(() => generateInput(
            randomTesting ? randInt(1, maxChannelCount) : maxChannelCount,
            sampleFrameLength,
            randomTesting
        ))
    );
    const processWriteTimes = new Uint32Array(requiredProcessCount);

    for (let i=0; i<requiredProcessCount; i++) {
        const startT = performance.now();
        const writeStatus = manager.writeProcess(inputProcesses[i]);
        processWriteTimes[i] = performance.now() - startT;

        expect(writeStatus, "Write successful?").toBe(0);
    }
    const maxProcessWriteTime = processWriteTimes.reduce((prev,curr)=>Math.max(curr,prev));
    const avgProcessWriteTime = processWriteTimes.reduce((prev,curr)=>prev+curr)/processWriteTimes.length;
    console.log(
        `Process write times (${processWriteTimes.length}):\n`
        +`\tMax: ${maxProcessWriteTime}ms\n`
        +`\tAverage: ${avgProcessWriteTime}ms`
        // +`\nAll: [${processWriteTimes.join(", ")}]`
        +`\n`
    );

    const processIndices = manager.getAllProcessIndices();
    console.log(`process-start indices: ${processIndices.join(", ")}\n`);

    const processReadTimes = new Uint32Array(processIndices.length);
    const outputProcesses = processIndices.map((index, i) => {
        const startT = performance.now();
        const process = manager.readProcess(manager.findNextProcess(index));
        processReadTimes[i] = performance.now() - startT;
        return process;
    });
    const maxProcessReadTime = processReadTimes.reduce((prev,curr)=>Math.max(curr,prev));
    const avgProcessReadTime = processReadTimes.reduce((prev,curr)=>prev+curr)/processReadTimes.length;
    console.log(
        `Process read times (${processWriteTimes.length}):\n`
        +`\tMax: ${maxProcessReadTime}ms\n`
        +`\tAverage: ${avgProcessReadTime}ms`
        // +`\nAll: [${processReadTimes.join(", ")}]`
        +`\n`
    );

    expect(inputProcesses.length).toBe(outputProcesses.length);
    for (let i=0; i<inputProcesses.length; i++) {
        compareProcesses(inputProcesses[i], outputProcesses[i]);
    }
}

const testProcessSearch: TestFunction = function(context) {
    const processIndices = manager.getAllProcessIndices();
    const processes = processIndices.map((index) => manager.readProcess(index));
    
    for (let i=0; i<processes.length; i++) {
        const index = manager.searchProcess(processes[i]);

        expect(index).toSatisfy((value) => !isNaN(value));
        expect(index).toBe(processIndices[i]);
    }
}

const testSampleGetter: TestFunction = function(context) {
    const { inputCount, maxChannelCount, sampleRate, fftRatio, sampleFrameLength, randomTesting } = MANAGER_CONFIG;
    const buf = new ArrayBuffer(AudioDataManager.estimateBufSize(inputCount, maxChannelCount));
    const cMan = new AudioDataManager(buf);
    const processes: Process[] = [];
    const requiredProcesses = estimateRequiredProcesses(MANAGER_CONFIG);
    cMan.initHeader(sampleRate, fftRatio);
    
    // TODO: in the future, all inputs and channels will need to be tested, and not just a single random one like now
    const inputIndex = randInt(0, inputCount-1);
    const channelIndex = randInt(0, maxChannelCount-1);
    const sampleCount = randInt(1, ((sampleFrameLength * requiredProcesses)-1) / 2);
    
    // For testing
    const printSampleCount = 50;
    const tempTestSamples: number[] = [];

    for (let i=0; i<requiredProcesses; i++) {
        const inputs: Process = [];
        for (let j=0; j<inputCount; j++) {
            const input = generateInput(maxChannelCount, sampleFrameLength, randomTesting);
            inputs.push(input);
        }
        processes.push(inputs);

        const status = cMan.writeProcess(inputs);
        expect(status).toBe(0);

        // For testing
        // tempTestSamples.push(...inputs[inputIndex][channelIndex]);
    }

    const cManSamples = cMan.getSamples(inputIndex, channelIndex, sampleCount);

    // For testing
    // let temp1 = processes[processes.length-1][inputIndex][channelIndex];
    // temp1 = temp1.slice(temp1.length-cManSamples.length).map(Float32.normalizeValue);
    // let temp2 = cManSamples.slice(cManSamples.length - temp1.length).map(Float32.normalizeValue);
    // const equalTemps = !temp1.some((num, i) => num !== temp2[i]);
    // if (!equalTemps) {
    //     console.log("og", temp1);
    //     console.log("getter", temp2);
    // }
    // console.log("sample equality?", equalTemps, `(${temp1.length}, ${temp2.length})`);

    const arrayIndexOf = function<T>(array: T[], items: T[]): number {
        let i = -1;

        arrayLoop: while(i < array.length-1) {
            i++;

            for (const item of items) {
                if (i < array.length && array[i] !== item) continue arrayLoop;
                i++;
            }

            return i - items.length;
        }

        return NaN;
    };

    // For testing
    // {
    //     const cManSamplesToPrint = cManSamples.slice(cManSamples.length - printSampleCount);
    //     console.log(`tempTestSamples (${tempTestSamples.length}) vs. cManSamples (${cManSamples.length})`)
    //     console.log(
    //         `Original samples [${arrayIndexOf(tempTestSamples, Array.from(cManSamplesToPrint))} / ${tempTestSamples.length}]: `+
    //         `[\n\t${tempTestSamples.slice(tempTestSamples.length - cManSamplesToPrint.length).join(", --\n\t")} --\n]`
    //     );
    //     console.log(`getSamples(): [\n\t${cManSamplesToPrint.join(",\n\t")}\n]`);
    // }
    
    // Verify that the pattern of samples can be found within the body
    const foundPatterns = cMan.searchSamples(cManSamples.slice(0, sampleFrameLength), 1);
    console.log(`searchSamples patterns:`, foundPatterns);
    expect(foundPatterns.length).greaterThan(0);

    // TODO: sometimes the test runs forever, and sometimes it successfully passes. Fix this issue so it consistently passes
    let sampleIndex = sampleCount-1;
    for (let i=processes.length-1; sampleIndex >= 0 && i >= 0; i--) {
        const channel = processes[i][inputIndex][channelIndex];
        
        // For testing
        // {
        //     const pRange = 8;
        //     const inputSlice = channel.slice(
        //         channel.length - pRange,
        //         // Math.max(0, j - Math.round(pRange/2)),
        //         // j + Math.ceil(pRange/2)
        //     ).map((float) => Float32.normalizeValue(float));
        //     const outputSlice = cManSamples.slice(
        //         cManSamples.length - inputSlice.length
        //         // Math.max(0, sampleCounter - Math.round(pRange/2)),
        //         // sampleCounter + Math.ceil(pRange/2)
        //     ).map((float) => Float32.normalizeValue(float));
        //     console.log(stringifyArrays(
        //         ["Input:", "Output:"],
        //         [inputSlice, outputSlice],
        //         true
        //     ));
        // };
        // console.log(
        //     `process: ${i} / ${processes.length-1}, `+
        //     `input: ${inputIndex} / ${processes[i].length-1}, `+
        //     `channel: ${channelIndex} / ${processes[i][inputIndex].length-1}`
        // );

        for (let j=channel.length-1; j>=0; j--) {
            const sample = channel[j];
            // console.log(`${j} -> 0`);
            // console.log(`index of sample: ${cManSamples.indexOf(sample)}`);
            // console.log("sample index: " + sampleIndex);
            expect(
                Float32.normalizeValue(sample)
            ).toBeCloseTo(
                Float32.normalizeValue(cManSamples[sampleIndex]),
                10
            );
            sampleIndex--;
            // throw new Error("brehhh");
            if (sampleIndex < 0) break;
        }
        // throw new Error("nice cock");
    }
}

// TODO: remove this later
test("");

// test("Stores and reads header values back correctly", testHeader);
// test(testSampleReadWrite, testSampleReadWrite);
// test(testProcessSearch, testProcessSearch);
// test(testSampleGetter, testSampleGetter);

function compareProcesses(process1: Process, process2: Process): void {
    const factor = 10 ** 5;
    const normalizeSample = (value: number): number => Math.floor(
        Float32.normalizeValue(value) * factor
    ) / factor;

    expect(process1.length).toBe(process2.length);

    for (let iI=0; iI<process1.length; iI++) {
        const input = process1[iI];
        const output = process2[iI];

        for (let cI=0; cI<input.length; cI++) {
            for (let sI=0; sI<input[cI].length; sI++) {
                const inputSample = normalizeSample(input[cI][sI]);
                const outputSample = normalizeSample(output[cI][sI]);

                // For testing
                const result = Object.is(inputSample, outputSample);
                if (!result) {
                    console.log(`Input: ${iI} Channel: ${cI} Sample: ${sI} - [${inputSample}, ${outputSample}]`);
                }

                // TODO: find out why the numbers, especially the first read sample, are sometimes off from input and output.
                // Can only recreate the issue when not normalizing the raw sample values.
                expect(inputSample).toBe(outputSample);
            }
            
            // For some reason arrayEquals always fails. May be an issue with comparing floating-point values
            // const isEqual = arrayEquals(input, output);
            // expect(isEqual).toBe(true);
        }
    }
}

function generateInput(channelCount: number, sampleCount: number, random: boolean = true): Process[number] {
    const input = new Array(channelCount);
    for (let c=0; c<channelCount; c++) {
        const channel = new Float32Array(sampleCount);
        for (let s=0; s<sampleCount; s++) {
            if (random) {
                channel[s] = randSample();
            } else {
                // 0, 1, 0, 1...
                channel[s] = s % 2;
            }
        }
        input[c] = channel;
    }
    return input;
}

function estimateRequiredProcesses(config: typeof MANAGER_CONFIG): number {
    const { fftRatio, sampleFrameLength, inputCount, maxChannelCount } = config;
    const samplesPerProcess = sampleFrameLength * maxChannelCount * inputCount;
    const requiredProcessCount = Math.ceil((2**fftRatio) / samplesPerProcess);
    return requiredProcessCount;
}

/**
 * @returns Random number from [-1, 1]
 */
function randSample(): number {
    const deg = randFloat(0, Math.PI * 2);
    return Float32.normalizeValue(Math.sin(deg));
}

function getManagerConfig(randomTesting: boolean = true) {
    const minFFT = AudioDataManager.FFT_RATIO_MIN.value;
    const maxFFT = AudioDataManager.FFT_RATIO_MAX.value;
    const sfls = new Array(5).fill(128/2).map((value, i) => value * (2**i));
    const rates = [44100, 48000, 96000] as const;
    const inputRange = [1, 5] as const;
    const channelRange = [1, 12] as const;

    let sampleFrameLength: number;
    let sampleRate: number;
    let fftRatio: number;
    let inputCount: number;
    let maxChannelCount: number;

    if (randomTesting) {
        sampleFrameLength = sfls[randInt(0, sfls.length-1)];
        sampleRate = rates[randInt(0, rates.length-1)];
        fftRatio = randInt(minFFT, maxFFT);
        inputCount = randInt(inputRange[0], inputRange[1]);
        maxChannelCount = randInt(channelRange[0], channelRange[1]);
    } else {
        sampleFrameLength = 128;
        sampleRate = rates[0];
        fftRatio = minFFT;
        inputCount = inputRange[0];
        maxChannelCount = channelRange[0];
    }

    return {
        randomTesting,
        sampleFrameLength,
        sampleRate,
        fftRatio,
        inputCount,
        maxChannelCount
    };
}