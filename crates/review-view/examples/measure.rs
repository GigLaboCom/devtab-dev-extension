//! How long the built-in line differs take on a large pair: the comparison runs synchronously on the editor page's
//! thread, so this is what a request costs before anything is drawn.
//!
//!   cargo run --release -p review-view --no-default-features --example measure [-- <lines>...]
//!
//! The pair is the contract suite's large input: unique lines, and in every thousand a modification, a deletion and
//! an insertion (150 hunks per 50 000 lines).

use std::time::{Duration, Instant};

use review_view::line_differ::built_ins;

fn pair(line_count: usize) -> (String, String) {
    let base = |i: usize| format!("    let value_{i} = compute({i}, \"row {i}\");");
    let (mut old, mut new) = (Vec::new(), Vec::new());
    for i in 0..line_count {
        old.push(base(i));
        match i % 1000 {
            100 => new.push(format!("    let value_{i} = compute({i}, \"row {i}\") + 1;")),
            400 => {}
            700 => {
                new.push(base(i));
                new.push(format!("    log(\"inserted after {i}\");"));
            }
            _ => new.push(base(i)),
        }
    }
    (old.join("\n") + "\n", new.join("\n") + "\n")
}

fn main() {
    let sizes: Vec<usize> = std::env::args().skip(1).filter_map(|a| a.parse().ok()).collect();
    let sizes = if sizes.is_empty() {
        vec![6_250, 50_000, 200_000]
    } else {
        sizes
    };
    const RUNS: usize = 15;
    for lines in sizes {
        let (old, new) = pair(lines);
        println!("{lines} lines, {} + {} bytes", old.len(), new.len());
        for differ in built_ins() {
            let mut times: Vec<Duration> = (0..RUNS)
                .map(|_| {
                    let started = Instant::now();
                    std::hint::black_box(differ.line_hunks(&old, &new));
                    started.elapsed()
                })
                .collect();
            times.sort();
            let hunks = differ.line_hunks(&old, &new).len();
            println!(
                "  {:<9} {hunks:>4} hunks  median {:>7.2} ms  min {:>7.2} ms  max {:>7.2} ms",
                differ.name(),
                ms(times[RUNS / 2]),
                ms(times[0]),
                ms(times[RUNS - 1]),
            );
        }
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}
