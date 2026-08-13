import { main } from './cli.js';

// БЕЗ process.exit(): запись большого JSON в пайп асинхронна, exit сразу после
// write обрубает недописанный хвост (шрам лаборатории; эталон — Vibe-Street eval.ts).
// process.exitCode даёт процессу слить буферы и завершиться самому.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
