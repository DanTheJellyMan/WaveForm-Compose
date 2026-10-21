struct ComplexPair {
    real: f32,
    imag: f32
}

@group(0) @binding(1)
var<storage, read> audio_samples: array<f32>;
@group(0) @binding(2)
var<storage, read_write> complex_samples: array<ComplexPair>;

fn reverse_bits(value: u32, bit_count: u32) -> u32 {
    var result = 0u;

    for (var i = 0u; i < bit_count; i++) {
        result = (result << 1u) | ((value >> i) & 1u);
    }

    return result;
}

@compute @workgroup_size(64)
fn preprocess_samples(
    @builtin(global_invocation_id) gid: vec3u
) {
    let i = gid.x;
    let len = gl_uniforms.fft.size;
    if (i >= len) {
        return;
    }

    // FFT size is always a power of 2,
    // so this tells us how many bits are in an index.
    let bit_count = u32(log2(f32(len)));

    let reversed_i = reverse_bits(i, bit_count);

    complex_samples[reversed_i] = ComplexPair(audio_samples[i], 0.0);
}

@group(0) @binding(1)
var<storage, read> fft_input: array<ComplexPair>;
@group(0) @binding(2)
var<storage, read_write> fft_output: array<ComplexPair>;
@group(0) @binding(3)
var<uniform> stage: u32;

fn complex_mul(a: ComplexPair, b: ComplexPair) -> ComplexPair {
    return ComplexPair(
        a.real * b.real - a.imag * b.imag,
        a.real * b.imag + a.imag * b.real
    );
}
fn complex_add(a: ComplexPair, b: ComplexPair) -> ComplexPair {
    return ComplexPair(
        a.real + b.real,
        a.imag + b.imag
    );
}
fn complex_sub(a: ComplexPair, b: ComplexPair) -> ComplexPair {
    return ComplexPair(
        a.real - b.real,
        a.imag - b.imag
    );
}
@compute @workgroup_size(64)
fn fft_stage(
    @builtin(global_invocation_id) gid: vec3u
) {
    let i = gid.x;
    if (i >= gl_uniforms.fft.size / 2u) {
        return;
    }

    // The size of each butterfly group.
    //
    // stage 0 -> 2
    // stage 1 -> 4
    // stage 2 -> 8
    // ...
    let half_size = 1u << stage;
    let butterfly_size = half_size * 2u;

    // Which butterfly group are we in?
    let group = i / half_size;

    // Which position inside that butterfly?
    let j = i % half_size;

    // First element of this butterfly.
    let even_index = group * butterfly_size + j;

    // Second element of this butterfly.
    let odd_index = even_index + half_size;

    let even = fft_input[even_index];
    let odd = fft_input[odd_index];

    // ω^j
    let angle = -2.0 * PI * f32(j) / f32(butterfly_size);
    let omega = ComplexPair(cos(angle), sin(angle));
    let t = complex_mul(omega, odd);

    fft_output[even_index] = complex_add(even, t);
    fft_output[odd_index] = complex_sub(even, t);
}

fn compute_dft(n: u32, N: u32) -> ComplexPair {
    var complex_output = ComplexPair(0.0, 0.0);
    let inverse = bool(gl_uniforms.fft.inverse_bool);
    let angle_factor: f32 = select(-2.0, 2.0, inverse);

    for (var k=0u; k<N; k++) {
        let s: ComplexPair = fft_input[k];
        let angle = (angle_factor * PI * f32(n) * f32(k)) / f32(N);
        let omega = ComplexPair(cos(angle), sin(angle));
        let t = complex_mul(s, omega);
        complex_output = complex_add(complex_output, t);
    }

    let divisor: f32 = select(1.0, f32(N), inverse);
    return complex_output;
}
@compute @workgroup_size(64)
fn dft(
    @builtin(global_invocation_id) gid: vec3u
) {
    let n = gid.x;
    let N = gl_uniforms.fft.size;
    if (n >= N) {
        return;
    }
    fft_output[n] = compute_dft(n, N);
}

@group(0) @binding(1)
var<storage, read> mag_input: array<ComplexPair>;
@group(0) @binding(2)
var<storage, read_write> mag_output: array<f32>;

fn log10(x: f32) -> f32 {
    // Log base-change identity
    return log2(x) / log2(10.0);
}

@compute @workgroup_size(64)
fn magnitude(
    @builtin(global_invocation_id) gid: vec3u
) {
    let i = gid.x;
    let size = gl_uniforms.fft.size;
    if (i >= size) {
        return;
    }

    let real = mag_input[i].real;
    let imag = mag_input[i].imag;

    let mag = sqrt(real*real + imag*imag);
    var norm = 2.0 * mag / f32(size);
    let db = 20.0 * log10(norm);

    mag_output[i] = db;
}