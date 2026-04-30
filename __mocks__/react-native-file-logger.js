/**
 * No-op mock for react-native-file-logger used in Jest tests.
 * All log calls are swallowed silently.
 */

const LogLevel = { Debug: 0, Info: 1, Warning: 2, Error: 3 };

const FileLogger = {
  configure: jest.fn().mockResolvedValue(undefined),
  enableConsoleCapture: jest.fn(),
  disableConsoleCapture: jest.fn(),
  setLogLevel: jest.fn(),
  getLogLevel: jest.fn().mockReturnValue(LogLevel.Debug),
  getLogFilePaths: jest.fn().mockResolvedValue([]),
  deleteLogFiles: jest.fn().mockResolvedValue(undefined),
  sendLogFilesByEmail: jest.fn().mockResolvedValue(undefined),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  write: jest.fn(),
};

const logLevelNames = ['Debug', 'Info', 'Warning', 'Error'];
const defaultFormatter = (_level, msg) => msg;

module.exports = { FileLogger, LogLevel, logLevelNames, defaultFormatter };
