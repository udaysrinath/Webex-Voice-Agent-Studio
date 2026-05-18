export function getConfiguredWebexRoomId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const roomId = env.WEBEX_SPACE_ID;
  const trimmed = roomId?.trim();
  return trimmed || undefined;
}

export function buildConfiguredWebexMessageArgs(
  message: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const roomId = getConfiguredWebexRoomId(env);
  return roomId ? { message, roomId } : { message };
}
