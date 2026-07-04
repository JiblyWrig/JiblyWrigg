/** Smileys only — the single emoji set used by the picker. */
export const SMILEY_EMOJIS: string[] = [
  "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "☺️", "😚", "😙",
  "🥲", "😋", "😛", "😜", "🤪", "😝", "🤗", "🤭", "🤫", "🤔",
  "🤐", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥",
  "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮",
  "🥳", "🥺", "😎", "🤓", "🧐", "😕", "😟", "🙁", "☹️", "😮",
  "😯", "😲", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😢",
  "😭", "😱", "🥹", "🙂", "🙃", "😉", "🤤", "🤠", "🥸", "😺",
  "😸", "😻", "😼", "😽", "🙀", "😿", "😾", "🙈", "🙉", "🙊",
];

/** Detect if a string is made only of emoji characters (for big-emoji rendering). */
const EMOJI_REGEX =
  /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u;

export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > 24) return false;
  return EMOJI_REGEX.test(trimmed);
}
