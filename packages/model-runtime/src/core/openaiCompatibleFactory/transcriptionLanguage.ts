/** gpt-transcribe replaced the singular language hint with a language list. */
export function getTranscriptionLanguage(
  model: string,
  language?: string,
): { language?: string; languages?: string[] } {
  if (!language) return {};
  return /^gpt-transcribe(?:-|$)/.test(model) ? { languages: [language] } : { language };
}
