import { defaultAdjustments } from "../editorModel";
import type { Adjustments, TimelineItem } from "../editorModel";
const fragment=`#version 300 es
precision highp float;
uniform sampler2D source; uniform vec2 size; uniform vec4 tone; uniform vec4 color; uniform vec4 detail; uniform float grain; uniform float frame; uniform float pixel; uniform vec4 chroma;
in vec2 uv; out vec4 result;
float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+frame)*43758.5453);}
void main(){
vec2 pos=uv;if(pixel>1.)pos=(floor(uv*size/pixel)+.5)*pixel/size;
vec4 original=texture(source,pos);vec3 c=original.rgb;
vec2 d=max(1.,detail.x)/size;
vec3 soft=(texture(source,pos+vec2(d.x,0)).rgb+texture(source,pos-vec2(d.x,0)).rgb+texture(source,pos+vec2(0,d.y)).rgb+texture(source,pos-vec2(0,d.y)).rgb+c*4.)/8.;
if(detail.x>0.)c=mix(c,soft,min(1.,detail.x));c+=detail.y*(c-soft)*3.;
c*=exp2(tone.w);c+=tone.x;c=(c-.5)*tone.y+.5;float lum=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(lum),c,tone.z);
c+=vec3(color.x*.12,-color.y*.08,-color.x*.12);c+=color.z*pow(max(lum,0.),2.)*.3+color.w*pow(max(1.-lum,0.),2.)*.3;
c*=1.-detail.z*smoothstep(.25,.75,distance(uv,vec2(.5)));c+=(noise(floor(uv*size))-.5)*grain*.18;
float alpha=original.a;if(chroma.w>0.)alpha*=smoothstep(chroma.w,chroma.w+.12,distance(c,chroma.rgb));
result=vec4(clamp(c,0.,1.),alpha);
}`;
export class GpuProcessor {
  readonly canvas=document.createElement("canvas");
  private gl:WebGL2RenderingContext|null=null; private program:WebGLProgram|null=null; private texture:WebGLTexture|null=null;
  constructor(){
    const gl=this.canvas.getContext("webgl2",{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});this.gl=gl;if(!gl)return;
    const shader=(type:number,src:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||"Shader failed");return s;};
    try{
      const program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,`#version 300 es\nin vec2 position;out vec2 uv;void main(){uv=vec2((position.x+1.)*.5,(1.-position.y)*.5);gl_Position=vec4(position,0,1);}`));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error("GPU program unavailable");
      this.program=program;gl.useProgram(program);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const at=gl.getAttribLocation(program,"position");gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }catch{this.gl=null;}
  }
  get available(){return !!this.gl;}
  process(source:CanvasImageSource,width:number,height:number,adjustments:Partial<Adjustments>|undefined,chroma:TimelineItem["chroma_key"],time:number,pixelSize=0):CanvasImageSource {
    const gl=this.gl,p=this.program;if(!gl||!p)return source;
    const a={...defaultAdjustments,...adjustments};
    this.canvas.width=width;this.canvas.height=height;gl.viewport(0,0,width,height);gl.useProgram(p);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source as TexImageSource);
    const loc=(s:string)=>gl.getUniformLocation(p,s);
    gl.uniform2f(loc("size"),width,height);gl.uniform4f(loc("tone"),a.brightness,a.contrast,a.saturation,a.exposure);gl.uniform4f(loc("color"),a.temperature,a.tint,a.highlights,a.shadows);gl.uniform4f(loc("detail"),a.blur,a.sharpen,a.vignette,0);gl.uniform1f(loc("grain"),a.grain);gl.uniform1f(loc("frame"),Math.floor(time*30));gl.uniform1f(loc("pixel"),pixelSize);
    const hex=chroma?.color||"#00ff00";gl.uniform4f(loc("chroma"),parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,chroma?.enabled?Math.max(.01,chroma.similarity):0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);return this.canvas;
  }
  dispose(){this.gl?.getExtension("WEBGL_lose_context")?.loseContext();}
}
