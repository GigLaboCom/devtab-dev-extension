//! Billing helpers.

use std::collections::HashMap;

pub struct Invoice {
    pub id: u64,
    pub lines: Vec<Line>,
}

pub struct Line {
    pub sku: String,
    pub qty: u32,
    pub cents: u64,
}

impl Invoice {
    pub fn total(&self) -> u64 {
        self.lines.iter().map(|l| l.qty as u64 * l.cents).sum()
    }

    pub fn by_sku(&self) -> HashMap<&str, u32> {
        let mut out = HashMap::new();
        for l in &self.lines {
            *out.entry(l.sku.as_str()).or_insert(0) += l.qty;
        }
        out
    }

    pub fn legacy_total(&self) -> u64 {
        // Kept for the old export format.
        self.total()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}
