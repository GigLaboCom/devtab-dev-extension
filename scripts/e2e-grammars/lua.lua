-- A first-in first-out list of jobs.
local Queue = {}
Queue.__index = Queue

function Queue.new(limit)
  return setmetatable({ jobs = {}, limit = limit or 10 }, Queue)
end

function Queue:push(job)
  if #self.jobs >= self.limit then
    return nil, "queue is full"
  end
  table.insert(self.jobs, job)
  return true
end

local q = Queue.new(2)
print(q:push("build"), q:push("test"), q:push("deploy"))
return Queue
