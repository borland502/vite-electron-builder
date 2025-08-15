#!/usr/bin/env bun
/**
 * Simple workspace script runner for Bun until native -ws support parity.
 * Usage: bun run workspace-run <script> [<workspaceName>]
 * If workspaceName omitted, runs script in all workspaces that define it.
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const workspaces = rootPkg.workspaces || [];
const [,, scriptName, filterName] = process.argv;
if(!scriptName){
  console.error('Usage: bun run workspace-run <script> [<workspaceName>]');
  process.exit(1);
}

function globToRegex(pattern){
  // very naive: only supports packages/*
  if(pattern.endsWith('/*')){
    const base = pattern.slice(0, -2);
    return new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^/]+$');
  }
  return new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}

const matchedDirs = [];
for(const pattern of workspaces){
  const rx = globToRegex(pattern);
  // We only implement packages/* pattern used in this repo
  if(pattern === 'packages/*'){
    const { readdirSync, statSync } = await import('node:fs');
    for(const entry of readdirSync('packages')){
      const full = path.join('packages', entry);
      if(statSync(full).isDirectory() && rx.test(full)) matchedDirs.push(full);
    }
  }
}

async function runSequential(){
  for(const dir of matchedDirs){
    const pkgPath = path.join(dir, 'package.json');
    let pkg;
    try { pkg = JSON.parse(await readFile(pkgPath, 'utf8')); } catch { continue; }
    if(filterName && pkg.name !== filterName) continue;
    if(!pkg.scripts || !pkg.scripts[scriptName]) continue;
    console.log(`\n› ${pkg.name} :: ${scriptName}`);
    await new Promise((res, rej)=>{
      const isSingleWord = /^[^\s&|;]+$/.test(pkg.scripts[scriptName]);
      const child = isSingleWord
        ? spawn(process.execPath, ['--run', pkg.scripts[scriptName]], { cwd: dir, stdio: 'inherit', env: process.env })
        : spawn(process.env.SHELL || 'bash', ['-lc', pkg.scripts[scriptName]], { cwd: dir, stdio: 'inherit', env: process.env });
      child.on('exit', code=> code === 0 ? res() : rej(new Error(`${pkg.name} script ${scriptName} failed (${code})`)));
    });
  }
}

runSequential().catch(err=>{ console.error(err.message); process.exit(1); });
