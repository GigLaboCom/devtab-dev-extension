//! What a line is: the editor's lines, so that hunks are rows of the editor.
//!
//! The editor splits its text at `\n` and nothing else. A `\r` before it stays part of the line, so a CRLF line and
//! an LF line with the same words differ while every byte is significant (what counts as equal is the later
//! `ComparisonPolicy` seam). The empty text is one empty line, and a trailing newline opens one more, empty, line.
//! A difference in the trailing newline alone is therefore an added or removed empty last line.

/// The text's lines as the editor shows them, without their `\n`.
pub fn editor_lines(text: &str) -> std::str::Split<'_, char> {
    text.split('\n')
}

/// How many lines the editor shows for `text`: never zero.
pub fn editor_line_count(text: &str) -> usize {
    text.bytes().filter(|&byte| byte == b'\n').count() + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_lines_as_the_editor_does() {
        assert_eq!(editor_line_count(""), 1);
        assert_eq!(editor_line_count("a"), 1);
        assert_eq!(editor_line_count("a\n"), 2);
        assert_eq!(editor_line_count("a\nb"), 2);
        assert_eq!(editor_line_count("a\r\nb\r\n"), 3);
        assert_eq!(editor_line_count("\n\n"), 3);
        for text in ["", "a", "a\n", "a\r\nb\r", "x\ny\n\n"] {
            assert_eq!(editor_lines(text).count(), editor_line_count(text), "{text:?}");
        }
    }

    #[test]
    fn a_carriage_return_stays_in_its_line() {
        assert_eq!(editor_lines("a\r\nb\rc").collect::<Vec<_>>(), ["a\r", "b\rc"]);
    }
}
