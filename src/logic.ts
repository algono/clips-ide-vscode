export type RedirectData = [string, (data: string) => string];

export const prompt = 'CLIPS>';

// If there is a prompt inside the data, we can assume that the command output ended
export function commandEnded(data: string) {
  return data.includes(prompt);
}
