package review

import scala.collection.mutable

/** A first-in first-out list of jobs. */
final class Queue[A](limit: Int = 10) {
  private val jobs = mutable.Queue.empty[A]

  def push(job: A): Either[String, Int] =
    if (jobs.size >= limit) Left("queue is full")
    else {
      jobs.enqueue(job)
      Right(jobs.size)
    }

  def pop(): Option[A] = if (jobs.isEmpty) None else Some(jobs.dequeue())
}

object Main extends App {
  val q = new Queue[String](2)
  println(s"pushed: ${q.push("build")}, ${q.push("test")}, ${q.push("deploy")}")
}
