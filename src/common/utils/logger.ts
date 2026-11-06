type Level = 'debug' | 'info' | 'warn' | 'error';

const write = (level: Level, msg: string, meta?: Record<string, unknown>) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};
