// Writes the licence texts that ship with the app, from what is actually installed.
//   node scripts/notices.mjs
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (cmd, cwd = root) => execSync(cmd, { cwd, maxBuffer: 1 << 27 }).toString()
const texts = (dir) => fs.readdirSync(dir)
  .filter((f) => /^(licen[cs]e|copying|notice|ofl|unlicense)/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())

const packages = []
const meta = JSON.parse(run('cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc', path.join(root, 'src-tauri')))
for (const p of meta.packages) if (p.name !== 'clipit') packages.push({ id: `${p.name} ${p.version}`, licence: p.license, authors: p.authors?.join(', '), texts: texts(path.dirname(p.manifest_path)) })
for (const dir of run('npm ls --omit=dev --all --parseable').split(/\r?\n/).slice(1).filter(Boolean)) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  packages.push({ id: `${p.name} ${p.version}`, licence: p.license, authors: p.author?.name ?? p.author, texts: texts(dir) })
}
packages.sort((a, b) => a.id.localeCompare(b.id))

// Some packages publish no licence file. Give them the standard text of the licence they declare.
const mit = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').split(String.fromCharCode(13)).join('')
const mitBody = mit.slice(mit.indexOf('Permission is hereby granted')).trim()
const bsd3 = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`
const mpl = packages.flatMap((p) => p.texts).find((t) => t.startsWith('Mozilla Public License Version 2.0'))
for (const p of packages.filter((p) => !p.texts.length)) {
  const who = `Copyright (c) ${p.authors || `the authors of ${p.id.split(' ')[0]}`}`
  const text = /MIT/.test(p.licence) ? `MIT License

${who}

${mitBody}`
    : p.licence === 'BSD-3-Clause' ? `BSD 3-Clause License

${who}

${bsd3}`
    : p.licence === 'MPL-2.0' ? mpl
    : null
  if (text) p.texts = [text]
}

// Print each distinct text once, under the packages that use it.
const byText = new Map()
for (const p of packages) for (const t of p.texts) byText.set(t, [...(byText.get(t) ?? []), p.id])

const rule = '\n' + '-'.repeat(72) + '\n'
const out = [
  'AutoKlipper: third-party notices',
  'These libraries are part of the app. SQLite, also included, is in the public domain.',
  'The installer is built with NSIS (zlib licence). The window uses Microsoft WebView2.',
  'Packages and their licences:',
  packages.map((p) => `  ${p.id}: ${p.licence ?? 'see text'}`).join('\n'),
  'Source code for the MPL-2.0 packages is available from https://crates.io under the names and versions above.',
  ...[...byText].map(([t, ids]) => `${rule}Used by: ${ids.join(', ')}\n\n${t}`),
].join('\n\n')
fs.mkdirSync(path.join(root, 'public'), { recursive: true })
fs.writeFileSync(path.join(root, 'public', 'THIRD_PARTY_NOTICES.txt'), out + '\n')

// The one page the installer shows.
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
fs.writeFileSync(path.join(root, 'legal', 'INSTALLER_LICENSE.txt'), `${read('LICENSE')}${rule}\n${read('legal/TERMS_OF_USE.md')}`)

const without = packages.filter((p) => !p.texts.length).map((p) => p.id)
console.log(`${packages.length} packages, ${byText.size} distinct texts, ${without.length} without a licence file`)
