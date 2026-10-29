struct VertexOut {
    @builtin(position) pos: vec4f,
    @location(0) color: vec4f
}

struct Oklab {
    l: f32,
    a: f32,
    b: f32
}
struct Oklch {
    l: f32,
    c: f32,
    h: f32
}
struct Rgb {
    r: f32,
    g: f32,
    b: f32
}

@group(0) @binding(1)
var<storage, read> samps_db: array<f32>;

@vertex
fn vert_main(
    @builtin(instance_index) samp_i: u32,
    @builtin(vertex_index) vert_i: u32
) -> VertexOut {
    let audio_t = gl_uniforms.render.audio_t;
    let runtime_t = gl_uniforms.render.runtime_t;
    let date_t = gl_uniforms.render.date_t;

    // db: [-120, 0]
    let db = samps_db[samp_i];
    let samp_ct = gl_uniforms.fft.size / 2u;
    let width = 2.0 / f32(samp_ct);

    let tri_v = vert_i % 3u;
    var x = f32(samp_i) / f32(samp_ct) * 2.0 - 1.0 + (1.0 / f32(samp_ct));
    var y: f32;
    
    // Vertex order:
    if (tri_v == 0) {
        // BL
        x -= width / 2.0;
        y = -1.0;
    } else if (tri_v == 1) {
        // TR
        x += width / 2.0;
        y = (db / 120.0) * 2.0 + 1.0;
    } else {
        if (vert_i == 5) {
            // BR
            x += width / 2.0;
            y = -1.0;
        } else {
            // TL
            x -= width / 2.0;
            y = (db / 120.0) * 2.0 + 1.0;
        }
    }
    let pos = vec4f(x, y, 0.5, 1.0);

    let prog_x = abs((f32(samp_i) +
        (sin(f32(runtime_t)*0.0000125)+1.0)*1750.0 * 1.0
    ) % f32(samp_ct) / f32(samp_ct));
    let prog_y = (y + 1.0) / 2.0;
    let l = 0.5;
    let c = 0.15;
    let h = prog_x * 2.0 * PI;

    let lab = oklch_to_oklab(Oklch(l, c, h));
    let rgb = encode_linear_srgb(oklab_to_linear_srgb(lab));
    let color = vec4f(rgb.r, rgb.g, rgb.b, 1.0);
    
    return VertexOut(pos, color);
}

@fragment
fn frag_main(fragData: VertexOut) -> @location(0) vec4f {
    return fragData.color;
}

fn oklch_to_oklab(lch: Oklch) -> Oklab {
    let rev = 2.0 * PI;
    let l = clamp(lch.l, 0.0, 1.0);
    let c = clamp(lch.c, 0.0, 0.4);
    let h = ((lch.h % rev) + rev) % rev;
    let a = c * cos(h);
    let b = c * sin(h);
    return Oklab(l, a, b);
}

fn oklab_to_linear_srgb(lab: Oklab) -> Rgb {
    let l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    let m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    let s_ = lab.l - 0.0894841775 * lab.a - 1.2914855480 * lab.b;

    let l = pow(l_, 3);
    let m = pow(m_, 3);
    let s = pow(s_, 3);

    return Rgb(
		 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    );
}

fn encode_linear_srgb(rgb: Rgb) -> Rgb {
    return Rgb(
        encode_linear_srgb_channel(rgb.r),
        encode_linear_srgb_channel(rgb.g),
        encode_linear_srgb_channel(rgb.b)
    );
}
fn encode_linear_srgb_channel(c: f32) -> f32 {
    var e: f32;
    if (c <= 0.0031308) {
        e = 12.92 * c;
    } else {
        e = 1.055 * pow(c, 1.0/2.4) - 0.055;
    }
    return e;
}