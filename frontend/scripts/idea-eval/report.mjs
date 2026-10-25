import { main } from './run.mjs'
if (!process.argv[2]) { console.error('Usage: npm run eval:ideas:report -- directory'); process.exitCode = 2 }
else await main(['--report', process.argv[2]]).then((code) => { process.exitCode = code }).catch((error) => { console.error(error.message); process.exitCode = 2 })
