/** how many arrivals one poll may announce — a longer backlog drains across later polls (§4.5) */
export const INBOUND_PAGE_SIZE = 10;

/** consecutive failed polls before one outage notice is posted, so a blip stays quiet */
export const INBOUND_OUTAGE_THRESHOLD = 3;
