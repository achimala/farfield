export function resolveOwnerClientId(
  threadOwnerById: Map<string, string>,
  threadId: string,
  override?: string
): string {
  const mapped = threadOwnerById.get(threadId);
  if (mapped && mapped.trim()) {
    return mapped.trim();
  }

  if (override && override.trim()) {
    return override.trim();
  }

  throw new Error(
    "No owner client id is known for this thread yet. Wait for the desktop app to publish a thread event."
  );
}
