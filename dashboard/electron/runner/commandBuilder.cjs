const path=require('node:path');
function buildCommand(config,{rootDir,buildDir=path.join(rootDir,'build_verified','Release'),mpiexec='mpiexec'}={}){
  const base=['--rows',String(config.rows),'--cols',String(config.cols),'--steps',String(config.steps),'--density',String(config.density),'--seed',String(config.seed)];
  const outputName=`${config.backend}-${config.rows}x${config.cols}-${Date.now()}.json`;
  const outputPath=path.join(rootDir,'results','live',outputName);
  if(config.backend==='serial') return {file:path.join(buildDir,'wildfire_serial.exe'),args:[...base,'--output',outputPath],outputPath};
  if(config.backend==='openmp') return {file:path.join(buildDir,'wildfire_openmp.exe'),args:[...base,'--threads',String(config.threads),'--output',outputPath],outputPath};
  if(config.backend==='cuda') return {file:path.join(buildDir,'wildfire_cuda.exe'),args:[...base,'--block-size',String(config.blockSize),'--output',outputPath],outputPath};
  return {file:mpiexec,args:['-n',String(config.processes),path.join(buildDir,'wildfire_mpi.exe'),...base,'--output',outputPath],outputPath};
}
module.exports={buildCommand};
