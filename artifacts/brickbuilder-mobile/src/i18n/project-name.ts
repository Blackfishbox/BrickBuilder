const generatedProjectNames = new Set(["New model", "Neues Modell"]);

export function isGeneratedProjectName(name: string | null | undefined): boolean {
  return !name || generatedProjectNames.has(name);
}
