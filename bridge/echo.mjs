let n = 0
setInterval(() => {
  n += 1
  process.stdout.write(`echo ${n} ${Date.now()}\n`)
}, 700)
setTimeout(() => process.exit(0), 120000)
