#include <metal_stdlib>
using namespace metal;

// Presents the 640x296 canvas on the drawable.
//  - Pixel perfect (default): exact integer scale. Texels are fetched with
//    read() using integer math, so every canvas pixel becomes an exact NxN block.
//  - Sharp fit (setting): fractional scale that fills the screen. "Sharp
//    bilinear": each texel's interior stays solid and only the ~1 drawable
//    pixel seam between texels is blended, so pixels stay crisp without the
//    uneven 3/4-pixel widths plain nearest-neighbour gives at fractional scales.
// The viewport is set to the scaled rect; outside it keeps the letterbox color.

struct UpscaleUniforms {
    float2 origin;   // top-left of the scaled rect in drawable pixels
    float  scale;    // canvas -> drawable scale (integer in pixel-perfect mode)
    float  impact;   // 1 = anime impact frame (inverted, high contrast)
    float  sharp;    // 1 = sharp-fit filtering
};

struct VOut { float4 position [[position]]; };

vertex VOut upscale_vertex(uint vid [[vertex_id]]) {
    // Single oversized triangle covering the viewport.
    float2 p[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
    VOut o;
    o.position = float4(p[vid], 0.0, 1.0);
    return o;
}

fragment float4 upscale_fragment(VOut in [[stage_in]],
                                 texture2d<float, access::sample> canvas [[texture(0)]],
                                 constant UpscaleUniforms& u [[buffer(0)]]) {
    float2 size = float2(canvas.get_width(), canvas.get_height());
    float2 local = (in.position.xy - u.origin) / u.scale;     // canvas texel space
    float4 c;
    if (u.sharp > 0.5) {
        constexpr sampler lin(filter::linear, address::clamp_to_edge);
        float2 base = floor(local);
        float2 f = local - base - 0.5;
        float region = 0.5 - 0.5 / u.scale;                     // solid part of each texel
        float2 blend = (f - clamp(f, -region, region)) * u.scale + 0.5;
        c = canvas.sample(lin, (base + blend) / size);
    } else {
        uint2 texel = uint2(clamp(floor(local), float2(0.0), size - 1.0));
        c = canvas.read(texel);
    }
    if (u.impact > 0.5) {
        // One-frame impact flash: negative image with a hard contrast boost,
        // so the whole screen "cracks" for a single frame on huge hits.
        c.rgb = saturate((1.0 - c.rgb - 0.5) * 1.8 + 0.5);
    }
    return c;
}
