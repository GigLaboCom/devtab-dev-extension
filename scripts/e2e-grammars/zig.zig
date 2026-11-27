const std = @import("std");

/// A first-in first-out list of jobs.
pub const Queue = struct {
    jobs: std.ArrayList([]const u8),
    limit: usize = 10,

    pub fn push(self: *Queue, job: []const u8) !void {
        if (self.jobs.items.len >= self.limit) return error.Full;
        try self.jobs.append(job);
    }
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    var q = Queue{ .jobs = std.ArrayList([]const u8).init(gpa.allocator()), .limit = 2 };
    try q.push("build");
    std.debug.print("{d} jobs\n", .{q.jobs.items.len});
}
