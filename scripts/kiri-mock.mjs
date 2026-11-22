// Starts the scan server in the explicitly labelled mock mode. The same switch
// is available in production with KIRI_MOCK=1; this script only spares the
// operator from remembering the syntax on Windows and POSIX shells.
process.env.KIRI_MOCK ??= "1";

const { startKiriServer } = await import("../server/kiri-server.mjs");
await startKiriServer();
