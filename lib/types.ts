/**
 * Represents a line of response from the MPD server,
 * potentially including associated binary data.
 */
export interface ResponseLine {
	/** The raw text line received from the server. */
	raw: string;
	/** Associated binary data, if the raw line indicated it (e.g., "binary: 1234"). */
	binaryData?: Buffer;
}

/** Represents parsed time values (e.g., from 'Time: 10:60'). */
export interface ParsedTime {
	elapsed?: number;
	total: number;
}

/** Represents a parsed MPD range (e.g., from 'Range: 60-120' or 'Range: 180-'). */
export interface ParsedRange {
	start: number;
	end?: number;
}

/** Represents parsed audio format (e.g., from 'audio: 44100:16:2'). */
export interface ParsedAudio {
	originalValue: string;
	sampleRate: number;
	bits: number | string;
	channels: number;
	sampleRateShort?: { value: number; unit: string };
}

/**
 * Represents the structured MPD response after value parsing.
 * Contains known MPD fields with their expected types (or undefined if parsing failed
 * or field not present) and an index signature for any unknown fields.
 * c.f. https://mpd.readthedocs.io/en/latest/protocol.html
 */
export interface MpdTypedObject {
	// Base
	directory?: string;
	file?: string;
	size?: number;

	// Tags
	artist?: string[] | string;
	artistsort?: string[] | string;
	album?: string;
	albumsort?: string;
	albumartist?: string[] | string;
	albumartistsort?: string[] | string;
	title?: string;
	titlesort?: string;
	track?: number | string;
	name?: string;
	genre?: string;
	mood?: string;
	date?: string;
	originaldate?: string;
	composer?: string[] | string;
	composersort?: string[] | string;
	performer?: string[] | string;
	conductor?: string[] | string;
	work?: string;
	ensemble?: string[] | string;
	movement?: string;
	movementnumber?: string;
	showmovement?: boolean;
	location?: string;
	grouping?: string;
	comment?: string;
	disc?: number | string;
	label?: string;
	musicbrainzArtistid?: string;
	musicbrainzAlbumid?: string;
	musicbrainzAlbumartistid?: string;
	musicbrainzTrackid?: string;
	musicbrainzReleasegroupid?: string;
	musicbrainzReleasetrackid?: string;
	musicbrainzWorkid?: string;

	// Other metadata
	duration?: number;
	time?: ParsedTime;
	range?: ParsedRange | string;
	format?: ParsedAudio | string;
	lastModified?: Date | string;
	added?: Date | string;

	// Status
	partition?: string;
	volume?: number;
	repeat?: boolean;
	random?: boolean;
	single?: "0" | "1" | "oneshot";
	consume?: boolean;
	playlist?: number | string;
	playlistlength?: number;
	state?: "play" | "stop" | "pause";
	song?: number;
	songid?: number;
	nextsong?: number;
	nextsongid?: number;
	elapsed?: number;
	bitrate?: number;
	xfade?: number;
	mixrampdb?: number;
	mixrampdelay?: number;
	audio?: ParsedAudio | string;
	updatingDb?: number;
	error?: string;
	lastloadedplaylist?: string;

	// Stats
	artists?: number;
	albums?: number;
	songs?: number;
	uptime?: number;
	dbPlaytime?: number;
	dbUpdate?: number;
	playtime?: number;

	// Replay gain status
	replayGainMode?: string;

	// Queue
	id?: number;
	pos?: number;
	prio?: number;

	// Outputs
	outputid?: number | string;
	outputname?: string;
	plugin?: string;
	outputenabled?: boolean;
	attribute?: string;

	// Config
	musicDirectory?: string;
	playlistDirectory?: string;
	pcre?: string;

	// Commands
	command?: string;

	// Decoders
	suffix?: string;
	mimeType?: string;

	// Album art
	binary?: Buffer;
	type?: string;

	// Stickers
	sticker?: string;

	// Unknown fields
	[key: string]: unknown;

	// For accumulation of multiple lines
	children?: MpdTypedObject[];
}
