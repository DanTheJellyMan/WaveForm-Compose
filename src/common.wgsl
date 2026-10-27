struct GlobalUniforms {
    fft: FFTUniforms,
    @align(16) render: RenderUniforms
}

struct FFTUniforms {
    size: u32,
    inverse_bool: u32
}

struct RenderUniforms {
    audio_t: u32,
    audio_len: u32,
    runtime_t: u32,
    date_t: u32
}

const PI: f32 = 245850922.0 / 78256779.0;

@group(0) @binding(0)
var<uniform> gl_uniforms: GlobalUniforms;