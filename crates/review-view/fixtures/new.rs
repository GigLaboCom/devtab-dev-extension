//! Billing helpers.

use std::collections::HashMap;

/// Tax rate in basis points (1/100 of a percent).
pub const TAX_BPS: u64 = 2_000;

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
        let net: u64 = self.lines.iter().map(|l| l.qty as u64 * l.cents).sum();
        // Round half up instead of truncating.
        net + (net * TAX_BPS + 5_000) / 10_000
    }

    pub fn by_sku(&self) -> HashMap<&str, u32> {
        let mut out = HashMap::new();
        for l in &self.lines {
            *out.entry(l.sku.as_str()).or_insert(0) += l.qty;
        }
        out
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_invoice_totals_zero() {
        let invoice = Invoice { id: 1, lines: vec![] };
        assert_eq!(invoice.total(), 0);
    }
}
