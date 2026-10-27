struct VertexOut {
    @builtin(position) pos: vec4f,
    @location(0) color: vec4f
}

@group(0) @binding(1)
var<storage, read> samps_db: array<f32>;

@vertex
fn vert_main(
    @builtin(instance_index) samp_i: u32,
    @builtin(vertex_index) vert_i: u32
) -> VertexOut {
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

    let audio_t = gl_uniforms.render.audio_t;
    let runtime_t = gl_uniforms.render.runtime_t;
    let date_t = gl_uniforms.render.date_t;
    let prog_x = abs((f32(samp_i) +
        (sin(f32(runtime_t)*0.0000125)+1.0)*1750.0 * 1.0
    ) % f32(samp_ct) / f32(samp_ct));
    let prog_y = (y + 1.0) / 2.0;
    let r_x = f32(samp_i%15)/14.0 * prog_x;
    let g_x = (1.0 - prog_x) / 2.0;
    let b_x = (cos(f32(samp_i%2) * f32(samp_i%7))+1.0)/3.25;
    let avg = (r_x+g_x+b_x)/3.0;
    let color = select(
        vec4f(r_x+(b_x*0.075), g_x-(b_x*0.3), b_x-(b_x*0.15), 1.0),
        vec4f(mix(r_x, 1.0, 0.5), mix(g_x, 0.75, 0.4), mix(b_x, 0.825, 0.125), 1.0),
        vec4(samp_i%17==0||samp_i%13==0||samp_i%37==0)
    );

    var output: VertexOut;
    output.pos = pos;
    output.color = color;
    return output;
}

@fragment
fn frag_main(fragData: VertexOut) -> @location(0) vec4f {
    return fragData.color;
}