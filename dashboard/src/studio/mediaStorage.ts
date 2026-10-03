import { assetUrl } from "../api";
import type { EditorMedia, EditorProject } from "./editorModel";
const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open("shortforge-studio",1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("recovery"))db.createObjectStore("recovery");};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
export async function saveRecovery(id:string,project:EditorProject):Promise<void>{
  const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction("recovery","readwrite");tx.objectStore("recovery").put({project,updated:Date.now()},id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
export async function readRecovery(id:string):Promise<{project:EditorProject;updated:number}|undefined>{
  const db=await database();try{return await new Promise((resolve,reject)=>{const req=db.transaction("recovery").objectStore("recovery").get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}
}
/** Stream normalized source media to OPFS. Original local-engine assets stay authoritative. */
export async function cacheMedia(asset:EditorMedia,signal?:AbortSignal):Promise<File|null>{
  if(!navigator.storage?.getDirectory)return null;
  try{
    const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle("shortforge-media",{create:true});
    const name=encodeURIComponent(asset.id);let handle:FileSystemFileHandle;
    try{handle=await directory.getFileHandle(name);const existing=await handle.getFile();if(existing.size)return existing;}catch{/* First use. */}
    const estimate=await navigator.storage.estimate();const response=await fetch(assetUrl(asset),{signal});if(!response.ok||!response.body)return null;
    const size=Number(response.headers.get("content-length")||0);
    if(size&&estimate.quota&&estimate.usage&&size>estimate.quota-estimate.usage){await response.body.cancel();return null;}
    handle=await directory.getFileHandle(name,{create:true});const writer=await handle.createWritable();
    try{await response.body.pipeTo(writer,{signal});return await handle.getFile();}
    catch(error){await directory.removeEntry(name).catch(()=>{});throw error;}
  }catch(error){if(signal?.aborted)throw error;return null;}
}
export async function clearMediaCache():Promise<void>{
  if(!navigator.storage?.getDirectory)return;const root=await navigator.storage.getDirectory();try{await root.removeEntry("shortforge-media",{recursive:true});}catch(error){if(!(error instanceof DOMException && error.name === "NotFoundError"))throw error;}
}
