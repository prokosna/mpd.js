export const PACKAGE_NAME = "mpd3";
export const OK = "OK";
export const ACK_PREFIX = "ACK ";
export const CHANGED_EVENT_PREFIX = "changed: ";
export const EVENT_CONNECTION_AVAILABLE = "available";

// Regex to match the 'binary: <length>' header, case-insensitive. Captures the length.
export const BINARY_HEADER_REGEX = /^binary:\s*(\d+)$/i;
