const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { RunManager } = require('./runner/runManager.cjs');
let manager;
function createWindow() { const win=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:640,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}}); if(process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL); else win.loadFile(path.join(__dirname,'../dist/index.html')); }
function registerIpc(){ ipcMain.handle('wildfire:get-capabilities',()=>({electron:true,liveRuns:true,cudaBlockSizes:[128,256,512],backends:['serial','openmp','cuda','mpi']})); ipcMain.handle('wildfire:start-run',(_event,config)=>manager.start(config)); ipcMain.handle('wildfire:cancel-run',(_event,runId)=>manager.cancel(runId)); ipcMain.handle('wildfire:list-runs',()=>manager.list()); ipcMain.handle('wildfire:read-run',(_event,runId)=>manager.read(runId)); }
app.whenReady().then(()=>{const rootDir=path.resolve(__dirname,'../..');fs.mkdirSync(path.join(rootDir,'results','live'),{recursive:true});manager=new RunManager({rootDir,userDataDir:app.getPath('userData'),onEvent:event=>{for(const win of BrowserWindow.getAllWindows())win.webContents.send('wildfire:run-event',event)}});registerIpc();createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
