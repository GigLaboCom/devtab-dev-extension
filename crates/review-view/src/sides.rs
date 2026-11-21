//! The two sides as the host sees them: whether the user may edit each, what each held when it was loaded or last
//! saved (its baseline), and so whether its text has moved away from that. Plain data, testable without a window; the
//! view keeps one [`Sides`] next to its two editors.
//!
//! A side is *modified* while its text differs from its baseline — typing and undoing back to the loaded text leaves
//! it unmodified, as editors do. The baseline is what the host last loaded into the side or reported as saved.

use crate::alignment::DiffSide;

impl DiffSide {
    /// Both sides, old first: the order of every per-side array here.
    pub const BOTH: [DiffSide; 2] = [DiffSide::Old, DiffSide::New];

    pub fn index(self) -> usize {
        self as usize
    }

    pub fn other(self) -> DiffSide {
        match self {
            DiffSide::Old => DiffSide::New,
            DiffSide::New => DiffSide::Old,
        }
    }

    /// The side's name at the host boundary: `old` (the original, left) or `new` (the changed text, right).
    pub fn name(self) -> &'static str {
        match self {
            DiffSide::Old => "old",
            DiffSide::New => "new",
        }
    }

    pub fn from_name(name: &str) -> Option<DiffSide> {
        DiffSide::BOTH.into_iter().find(|side| side.name() == name)
    }
}

/// One side as the host shows it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SideState {
    /// The user may edit the side (it is read-only otherwise, the default).
    pub editable: bool,
    /// Its text differs from what was loaded into it or last saved.
    pub modified: bool,
    pub empty: bool,
}

/// Both sides' edit permission and baselines.
#[derive(Clone, Debug, Default)]
pub struct Sides {
    baselines: [String; 2],
    editable: [bool; 2],
}

impl Sides {
    /// The host put `text` into the side: from now on the side is modified when it differs from this.
    pub fn loaded(&mut self, side: DiffSide, text: &str) {
        text.clone_into(&mut self.baselines[side.index()]);
    }

    /// The host wrote `text` somewhere for the side (saved it): the new baseline.
    pub fn saved(&mut self, side: DiffSide, text: String) {
        self.baselines[side.index()] = text;
    }

    pub fn set_editable(&mut self, side: DiffSide, editable: bool) {
        self.editable[side.index()] = editable;
    }

    pub fn editable(&self, side: DiffSide) -> bool {
        self.editable[side.index()]
    }

    /// The sides trade places: each keeps its own baseline and permission, now on the other side.
    pub fn swap(&mut self) {
        self.baselines.swap(0, 1);
        self.editable.swap(0, 1);
    }

    /// How the side stands with `current` as its text.
    pub fn state(&self, side: DiffSide, current: &str) -> SideState {
        SideState {
            editable: self.editable(side),
            modified: current != self.baselines[side.index()],
            empty: current.is_empty(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_side_is_modified_while_its_text_differs_from_what_was_loaded() {
        let mut sides = Sides::default();
        sides.loaded(DiffSide::New, "a\nb\n");
        assert!(!sides.state(DiffSide::New, "a\nb\n").modified);
        assert!(sides.state(DiffSide::New, "a\nbc\n").modified);
        // Typing and undoing back to the loaded text: not modified any more.
        assert!(!sides.state(DiffSide::New, "a\nb\n").modified);
        // The other side was never loaded: empty is its baseline.
        assert_eq!(
            sides.state(DiffSide::Old, ""),
            SideState {
                editable: false,
                modified: false,
                empty: true
            }
        );
    }

    #[test]
    fn saving_moves_the_baseline() {
        let mut sides = Sides::default();
        sides.loaded(DiffSide::Old, "one\n");
        assert!(sides.state(DiffSide::Old, "two\n").modified);
        sides.saved(DiffSide::Old, "two\n".into());
        assert!(!sides.state(DiffSide::Old, "two\n").modified);
        assert!(sides.state(DiffSide::Old, "one\n").modified);
    }

    #[test]
    fn sides_are_read_only_until_made_editable() {
        let mut sides = Sides::default();
        assert!(DiffSide::BOTH.iter().all(|side| !sides.editable(*side)));
        sides.set_editable(DiffSide::New, true);
        assert!(sides.state(DiffSide::New, "").editable);
        assert!(!sides.state(DiffSide::Old, "").editable);
        sides.set_editable(DiffSide::New, false);
        assert!(!sides.editable(DiffSide::New));
    }

    #[test]
    fn a_swap_carries_baselines_and_permissions_to_the_other_side() {
        let mut sides = Sides::default();
        sides.loaded(DiffSide::Old, "left\n");
        sides.loaded(DiffSide::New, "right\n");
        sides.set_editable(DiffSide::New, true);
        sides.swap();
        assert!(!sides.state(DiffSide::Old, "right\n").modified);
        assert!(!sides.state(DiffSide::New, "left\n").modified);
        assert!(sides.editable(DiffSide::Old));
        assert!(!sides.editable(DiffSide::New));
    }

    #[test]
    fn side_names_at_the_boundary() {
        assert_eq!(DiffSide::from_name("old"), Some(DiffSide::Old));
        assert_eq!(DiffSide::from_name("new"), Some(DiffSide::New));
        assert_eq!(DiffSide::from_name("left"), None);
        assert_eq!(DiffSide::Old.other(), DiffSide::New);
        assert_eq!(DiffSide::BOTH.map(DiffSide::name), ["old", "new"]);
    }
}
