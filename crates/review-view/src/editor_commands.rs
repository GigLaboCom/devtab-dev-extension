//! The editor's own commands as a host may run them from a button: undo, redo, cut, copy, paste, select all, indent,
//! outdent and find. A command is a name for one of gpui-kit's input actions and nothing more: the view runs it by
//! focusing the side's editor and dispatching that action (`ReviewView::run_command`), the road a keystroke takes once
//! the key bindings have resolved it, so a button and its key cannot come to mean two different things. Paste is the
//! exception the browser forces: gpui-kit's Paste reads `navigator.clipboard`, which needs a permission, so the host
//! reads the clipboard itself and hands the text in (`ReviewView::paste_text`), inserted as one edit over the selection.
//!
//! The keys each command is bound to are one table, [`KEYS`] (`editor_keys.json`, which the extension's tooltips read
//! too): gpui-kit binds them at compile time and the module is never compiled for macOS, so in a browser on a Mac the
//! module binds the table's Mac column itself (`bind_module_keys`, feature `view`); the view's tests check that each
//! key resolves to its command's action.
//!
//! [`CommandStanding`] is what the host needs to grey a button: whether a side is editable, empty, has a selection —
//! flags only, never text. Free of gpui: `cargo test -p review-view --no-default-features` checks the names and the
//! table.

/// The keys of every command, by platform, in gpui's keystroke notation (`cmd-shift-z`): the one table.
pub const KEYS: &str = include_str!("editor_keys.json");

/// One of the editor's commands.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EditorCommand {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Indent,
    Outdent,
    Find,
}

impl EditorCommand {
    /// Every command, in the order a toolbar shows them.
    pub const ALL: [EditorCommand; 9] = [
        EditorCommand::Undo,
        EditorCommand::Redo,
        EditorCommand::Cut,
        EditorCommand::Copy,
        EditorCommand::Paste,
        EditorCommand::SelectAll,
        EditorCommand::Indent,
        EditorCommand::Outdent,
        EditorCommand::Find,
    ];

    /// The name at the host boundary (and the key of [`KEYS`]).
    pub fn name(self) -> &'static str {
        match self {
            EditorCommand::Undo => "undo",
            EditorCommand::Redo => "redo",
            EditorCommand::Cut => "cut",
            EditorCommand::Copy => "copy",
            EditorCommand::Paste => "paste",
            EditorCommand::SelectAll => "selectAll",
            EditorCommand::Indent => "indent",
            EditorCommand::Outdent => "outdent",
            EditorCommand::Find => "find",
        }
    }

    pub fn from_name(name: &str) -> Option<EditorCommand> {
        EditorCommand::ALL.into_iter().find(|command| command.name() == name)
    }

    /// Whether it changes the text: the view refuses it on a read-only side.
    pub fn edits(self) -> bool {
        matches!(
            self,
            EditorCommand::Undo
                | EditorCommand::Redo
                | EditorCommand::Cut
                | EditorCommand::Paste
                | EditorCommand::Indent
                | EditorCommand::Outdent
        )
    }
}

/// What a side offers its commands now: flags only, never its text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CommandStanding {
    /// The user may edit the side.
    pub editable: bool,
    pub empty: bool,
    /// Something is selected (Cut and Copy have something to take).
    pub selection: bool,
}

/// The table's key for `command` on a Mac or elsewhere, read from [`KEYS`]; `None` when it names none. A small reader
/// of the table's one shape (`"name": { "mac": "…", "other": "…" }`), so the gpui-free crate needs no JSON parser.
pub fn key_of(command: EditorCommand, mac: bool) -> Option<&'static str> {
    let entry = KEYS.split_once(&format!("\"{}\":", command.name()))?.1;
    let entry = &entry[..entry.find('}')?];
    let column = if mac { "\"mac\":" } else { "\"other\":" };
    let value = entry.split_once(column)?.1.trim_start().strip_prefix('"')?;
    Some(&value[..value.find('"')?])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_at_the_boundary_go_both_ways() {
        for command in EditorCommand::ALL {
            assert_eq!(EditorCommand::from_name(command.name()), Some(command));
        }
        assert_eq!(EditorCommand::from_name("copyAll"), None);
        assert_eq!(EditorCommand::from_name("Undo"), None);
    }

    #[test]
    fn the_table_names_a_key_for_every_command_on_both_platforms() {
        for command in EditorCommand::ALL {
            let mac = key_of(command, true).unwrap_or_else(|| panic!("{} has no Mac key", command.name()));
            let other = key_of(command, false).unwrap_or_else(|| panic!("{} has no other key", command.name()));
            assert!(mac.starts_with("cmd-"), "{mac}");
            assert!(other.starts_with("ctrl-"), "{other}");
        }
        assert_eq!(key_of(EditorCommand::Redo, true), Some("cmd-shift-z"));
        assert_eq!(key_of(EditorCommand::Redo, false), Some("ctrl-y"));
        assert_eq!(key_of(EditorCommand::Outdent, true), Some("cmd-["));
    }

    #[test]
    fn only_the_commands_that_change_the_text_need_an_editable_side() {
        let editing: Vec<_> = EditorCommand::ALL.into_iter().filter(|c| c.edits()).collect();
        assert_eq!(
            editing,
            [
                EditorCommand::Undo,
                EditorCommand::Redo,
                EditorCommand::Cut,
                EditorCommand::Paste,
                EditorCommand::Indent,
                EditorCommand::Outdent
            ]
        );
    }
}
