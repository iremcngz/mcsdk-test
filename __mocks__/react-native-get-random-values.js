/**
 * In-memory mock for react-native-get-random-values used in Jest.
 * The real package polyfills crypto.getRandomValues for Hermes.
 * In Node.js, crypto.getRandomValues already exists, so this is a no-op.
 */
// No-op: Node.js already has crypto.getRandomValues natively.
