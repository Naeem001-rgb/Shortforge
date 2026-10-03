import { transitions } from "../transitions";
const fragment=`#version 300 es
precision highp float;
uniform sampler2D firstFrame;uniform sampler2D secondFrame;uniform float progress;uniform int mode;uniform vec2 dimensions;
in vec2 uv;out vec4 result;
vec4 first(vec2 p){if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))return vec4(0);return texture(firstFrame,p);}
vec4 second(vec2 p){if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))return vec4(0);return texture(secondFrame,p);}
vec4 radial(bool incoming,vec2 p,float radius){vec4 sum=vec4(0);for(int n=0;n<8;n++){vec2 q=p+(p-.5)*radius*(float(n)/7.-.5);sum+=incoming?second(q):first(q);}return sum/8.;}
vec4 soft(bool incoming,vec2 p,float radius){vec4 sum=vec4(0);for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){vec2 q=p+vec2(x,y)*radius/dimensions;sum+=incoming?second(q):first(q);}return sum/9.;}
void main(){float q=clamp(progress,0.,1.);float p=q*q*(3.-2.*q);float bell=1.-abs(2.*q-1.);vec4 a=first(uv),b=second(uv);result=mix(a,b,p);
if(mode==1||mode==2){vec4 c=mode==1?vec4(0,0,0,1):vec4(1);result=q<.5?mix(a,c,q*2.):mix(c,b,q*2.-1.);}
else if(mode>=3&&mode<=6){vec2 d=mode==3?vec2(p,0):mode==4?vec2(-p,0):mode==5?vec2(0,p):vec2(0,-p);vec2 edge=mode==3?vec2(-1,0):mode==4?vec2(1,0):mode==5?vec2(0,-1):vec2(0,1);result=first(uv+d)+second(uv+d+edge);}
else if(mode==7){vec2 aUv=uv+vec2(q,0);vec2 bUv=(uv+vec2(q-1.,0)-.5)/(1.-.04*(1.-q))+.5;result=first(aUv)+second(bUv);}
else if(mode==8){result=mix(radial(false,(uv-.5)/(1.+.3*p)+.5,bell*.2),radial(true,(uv-.5)/(.8+.2*p)+.5,bell*.2),p);}
else if(mode==9){result=mix(soft(false,uv,22.*bell),soft(true,uv,22.*bell),p);}
else if(mode==10){vec4 sum=vec4(0);for(int n=0;n<8;n++){float offset=(float(n)/7.-.5)*.1*bell;sum+=first(uv+vec2(q+offset,0))+second(uv+vec2(q-1.+offset,0));}result=sum/8.;}
else if(mode==11||mode==12){vec2 physical=(uv-.5)*dimensions;float radius=length(dimensions)*.5*(mode==11?q:1.-q);float inside=1.-smoothstep(radius-1.,radius+1.,length(physical));result=mode==11?mix(a,b,inside):mix(b,a,inside);}
else if(mode==13)result=mix(a,b,1.-step(q,uv.x));
else if(mode==14)result=mix(a,b,step(1.-q,uv.x));
else if(mode==15)result=mix(a,b,step(1.-q,uv.y));
else if(mode==16)result=mix(a,b,1.-step(q,uv.y));
else if(mode==17){float angle=mod(atan(uv.x-.5,.5-uv.y)+6.2831853,6.2831853)/6.2831853;result=mix(a,b,1.-step(q,angle));}
else if(mode==18){float size=max(1.,48.*bell);vec2 block=(floor(uv*dimensions/size)+.5)*size/dimensions;result=mix(first(block),second(block),p);}
else if(mode==19){float lum=dot(a.rgb,vec3(.2126,.7152,.0722));float reveal=smoothstep(lum-.08,lum+.08,q*1.16-.08);float flame=max(0.,1.-abs(lum-q)/.1)*bell;result=mix(a,b,reveal);result.rgb+=vec3(1.,.5,.15)*flame*.7;}
if(q<=0.)result=a;if(q>=1.)result=b;
}`;
/** Twenty original GPU transition programs, sharing only a draw interface. */
export class GpuTransitions {
  readonly canvas=document.createElement("canvas");
  private gl:WebGL2RenderingContext|null;private program:WebGLProgram|null=null;private textures:WebGLTexture[]=[];
  constructor(){
    const gl=this.canvas.getContext("webgl2",{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});this.gl=gl;if(!gl)return;
    const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error("Transition shader is unavailable");return shader;};
    try{const program=gl.createProgram()!;gl.attachShader(program,compile(gl.VERTEX_SHADER,`#version 300 es\nlayout(location=0)in vec2 position;out vec2 uv;void main(){uv=vec2((position.x+1.)*.5,(1.-position.y)*.5);gl_Position=vec4(position,0,1);}`));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error("Transition program could not link");this.program=program;gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      this.textures=[0,1].map(unit=>{const texture=gl.createTexture()!;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return texture;});
    }catch{this.gl=null;}
  }
  get available(){return !!this.gl;}
  render(first:HTMLCanvasElement,second:HTMLCanvasElement,id:string,progress:number):HTMLCanvasElement|null{
    const gl=this.gl,program=this.program;if(!gl||!program)return null;
    const width=first.width,height=first.height;if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}gl.viewport(0,0,width,height);gl.useProgram(program);
    [first,second].forEach((source,index)=>{gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,this.textures[index]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);});
    gl.uniform1i(gl.getUniformLocation(program,"firstFrame"),0);gl.uniform1i(gl.getUniformLocation(program,"secondFrame"),1);gl.uniform1i(gl.getUniformLocation(program,"mode"),transitions.findIndex(t=>t.id===id));gl.uniform1f(gl.getUniformLocation(program,"progress"),progress);gl.uniform2f(gl.getUniformLocation(program,"dimensions"),width,height);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);return this.canvas;
  }
  dispose(){this.gl?.getExtension("WEBGL_lose_context")?.loseContext();}
}
