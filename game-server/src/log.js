/** Log a line with the wall-clock time and the time since the process started. */
export function log(message) {
    const uptime = (performance.now() / 1000).toFixed(3);
    console.log(`${new Date().toISOString()} [+${uptime}s] ${message}`);
}
