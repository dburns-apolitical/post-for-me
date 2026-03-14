export function maskToken(token: string): string {
    if (token.length <= 8) return '****';
    return token.slice(0, 4) + '...' + token.slice(-4);
}

export function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(credentials)) {
        masked[key] = typeof value === 'string' ? maskToken(value) : value;
    }
    return masked;
}
