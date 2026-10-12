#include <metal_stdlib>
using namespace metal;

// Presents the 640x296 canvas on the drawable at an exact integer scale.
// The viewport is set to the scaled rect; the area outside it keeps the
// letterbox clear color. Texels are fetched with read() using integer math,
// so every canvas pixel becomes an exact NxN block (no filtering at all).

struct UpscaleUniforms {
    float2 origin;   // top-left of the scaled rect in drawable pixels
    float  scale;    // integer scale factor
    float  impact;   // 1 = anime impact frame (inverted, high contrast)
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
                                 texture2d<float, access::read> canvas [[texture(0)]],
                                 constant UpscaleUniforms& u [[buffer(0)]]) {
    float2 local = floor((in.position.xy - u.origin) / u.scale);
    uint2 texel = uint2(clamp(local, float2(0.0), float2(canvas.get_width() - 1, canvas.get_height() - 1)));
    float4 c = canvas.read(texel);
    if (u.impact > 0.5) {
        // One-frame impact flash: negative image with a hard contrast boost,
        // so the whole screen "cracks" for a single frame on huge hits.
        c.rgb = saturate((1.0 - c.rgb - 0.5) * 1.8 + 0.5);
    }
    return c;
}
