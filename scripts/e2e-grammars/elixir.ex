defmodule Review.Queue do
  @moduledoc "A first-in first-out list of jobs."
  use GenServer

  # Starts the queue with a limit.
  def start_link(limit \\ 10) when is_integer(limit) do
    GenServer.start_link(__MODULE__, %{jobs: [], limit: limit}, name: __MODULE__)
  end

  @impl true
  def handle_call({:push, job}, _from, %{jobs: jobs, limit: limit} = state) do
    if length(jobs) >= limit do
      {:reply, {:error, :full}, state}
    else
      {:reply, :ok, %{state | jobs: jobs ++ [job]}}
    end
  end
end
