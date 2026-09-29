// Files dropped on the home screen, handed to the editor once it opens.
const pending = new Map<string, File[]>();
export const pendingImport = {
  set: (projectId: string, files: File[]) => pending.set(projectId, files),
  take(projectId: string): File[] {
    const f = pending.get(projectId) ?? [];
    pending.delete(projectId);
    return f;
  },
};
