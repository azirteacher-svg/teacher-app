/*
 * Teacher Gradebook App
 *
 * This script manages students, assignments, and grades using the browser's
 * localStorage. It dynamically renders lists, a grades table, and a summary
 * of average scores. Teachers can add and remove students and assignments,
 * enter grades for each student/assignment combination, and view computed
 * averages to gain insights into class performance.
 */

(function () {
  // In-memory state of the app. Will be loaded from localStorage on startup.
  // students: array of { id, name, gender, section }
  let students = [];
  // assignments: array of { id, title, subject, date, questions: [{ id, text, maxPoints, topic }] }
  let assignments = [];
  // grades: nested object: grades[studentId][assignmentId][questionId] = value (number|null)
  let grades = {};

  // Utility: Save current state to localStorage
  function saveData() {
    // Write to localStorage with error handling. Some environments (such as
    // file:// origins or private browsing) may disallow storage writes, which
    // would otherwise throw and prevent the UI from updating. Catch errors and
    // fail silently so the rest of the app continues to work.
    try {
      localStorage.setItem('tg_students', JSON.stringify(students));
      localStorage.setItem('tg_assignments', JSON.stringify(assignments));
      localStorage.setItem('tg_grades', JSON.stringify(grades));
    } catch (err) {
      // If saving fails, log to console for debugging but do not stop execution.
      try {
        console.warn('Unable to save data to localStorage:', err);
      } catch (_) {
        /* no-op */
      }
    }
  }

  // Utility: Load state from localStorage
  function loadData() {
    try {
      students = JSON.parse(localStorage.getItem('tg_students')) || [];
    } catch (e) {
      students = [];
    }
    try {
      assignments = JSON.parse(localStorage.getItem('tg_assignments')) || [];
    } catch (e) {
      assignments = [];
    }
    try {
      grades = JSON.parse(localStorage.getItem('tg_grades')) || {};
    } catch (e) {
      grades = {};
    }
  }

  // Utility: Generate a unique ID (string) based on timestamp and random
  function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  // Student operations
  function addStudent(name, gender, section) {
    const id = generateId('stu');
    // Normalize gender: if empty string or undefined, store as null
    const g = gender && gender.trim() !== '' ? gender.trim() : null;
    // Normalize section: if empty string or undefined, store as null
    const s = section && section.trim() !== '' ? section.trim() : null;
    students.push({ id, name, gender: g, section: s });
    // Ensure a grades entry exists for the new student
    grades[id] = grades[id] || {};
    // Initialise grade structure for existing assignments
    assignments.forEach((assignment) => {
      grades[id][assignment.id] = grades[id][assignment.id] || {};
      assignment.questions.forEach((q) => {
        grades[id][assignment.id][q.id] = grades[id][assignment.id][q.id] || null;
      });
    });
    saveData();
    renderAll();
  }

  function deleteStudent(studentId) {
    students = students.filter((s) => s.id !== studentId);
    delete grades[studentId];
    saveData();
    renderAll();
  }

  // Assignment and test operations
  /**
   * Add a new assignment/test with subject and questions.
   * Each question should have an id, text, maxPoints, and topic.
   */
  function addAssignment(title, subject, questions) {
    const id = generateId('ass');
    const date = new Date().toISOString();
    assignments.push({ id, title, subject, date, questions });
    // Initialise grades for this assignment's questions for existing students
    students.forEach((s) => {
      if (!grades[s.id]) grades[s.id] = {};
      grades[s.id][id] = grades[s.id][id] || {};
      questions.forEach((q) => {
        grades[s.id][id][q.id] = grades[s.id][id][q.id] || null;
      });
    });
    saveData();
    renderAll();
  }

  function deleteAssignment(assignmentId) {
    assignments = assignments.filter((a) => a.id !== assignmentId);
    // Remove associated grades for this assignment across all students
    Object.keys(grades).forEach((studentId) => {
      if (grades[studentId]) {
        delete grades[studentId][assignmentId];
      }
    });
    saveData();
    renderAll();
  }

  // Update grade for a specific student, assignment, and question
  function updateGrade(studentId, assignmentId, questionId, value) {
    if (!grades[studentId]) grades[studentId] = {};
    if (!grades[studentId][assignmentId]) grades[studentId][assignmentId] = {};
    const numeric = value === '' ? null : parseFloat(value);
    grades[studentId][assignmentId][questionId] = isNaN(numeric) ? null : numeric;
    saveData();
    // Update displays
    renderGradesTable();
    renderSummary();
    renderAnalysis();
    renderTopicAnalysis();
    renderCharts();
  }

  // Compute average percentage for a student across all assignments and questions
  function computeStudentAverage(studentId) {
    let totalPoints = 0;
    let totalMax = 0;
    assignments.forEach((assignment) => {
      assignment.questions.forEach((q) => {
        const val = grades[studentId] && grades[studentId][assignment.id] && grades[studentId][assignment.id][q.id];
        if (typeof val === 'number') {
          totalPoints += val;
          totalMax += Number(q.maxPoints);
        }
      });
    });
    if (totalMax === 0) return null;
    return (totalPoints / totalMax) * 100;
  }

  // Compute the overall class average (percentage) across all students and questions
  function computeClassAverage() {
    let totalPoints = 0;
    let totalMax = 0;
    assignments.forEach((assignment) => {
      assignment.questions.forEach((q) => {
        const max = Number(q.maxPoints);
        students.forEach((student) => {
          const val = grades[student.id] && grades[student.id][assignment.id] && grades[student.id][assignment.id][q.id];
          if (typeof val === 'number' && max > 0) {
            totalPoints += val;
            totalMax += max;
          }
        });
      });
    });
    if (totalMax === 0) return null;
    return (totalPoints / totalMax) * 100;
  }

  // Compute performance improvement percentage for a student between early and later assignments
  function computeStudentImprovement(studentId) {
    if (assignments.length < 2) return null;
    // Sort assignments by date ascending
    const sorted = assignments.slice().sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });
    const mid = Math.floor(sorted.length / 2);
    let earlyPoints = 0;
    let earlyMax = 0;
    for (let i = 0; i < mid; i++) {
      const ass = sorted[i];
      ass.questions.forEach((q) => {
        const val = grades[studentId] && grades[studentId][ass.id] && grades[studentId][ass.id][q.id];
        if (typeof val === 'number') {
          earlyPoints += val;
          earlyMax += Number(q.maxPoints);
        }
      });
    }
    let laterPoints = 0;
    let laterMax = 0;
    for (let i = mid; i < sorted.length; i++) {
      const ass = sorted[i];
      ass.questions.forEach((q) => {
        const val = grades[studentId] && grades[studentId][ass.id] && grades[studentId][ass.id][q.id];
        if (typeof val === 'number') {
          laterPoints += val;
          laterMax += Number(q.maxPoints);
        }
      });
    }
    if (earlyMax === 0 || laterMax === 0) return null;
    const earlyAvg = earlyPoints / earlyMax;
    const laterAvg = laterPoints / laterMax;
    return (laterAvg - earlyAvg) * 100;
  }

  // Compute topic-level performance for a student
  function computeTopicPerformance(studentId) {
    const performance = {};
    assignments.forEach((assignment) => {
      assignment.questions.forEach((q) => {
        const val = grades[studentId] && grades[studentId][assignment.id] && grades[studentId][assignment.id][q.id];
        if (typeof val === 'number') {
          if (!performance[q.topic]) performance[q.topic] = { points: 0, max: 0 };
          performance[q.topic].points += val;
          performance[q.topic].max += Number(q.maxPoints);
        }
      });
    });
    return performance;
  }

  // Compute topic-level performance across the whole class
  function computeClassTopicPerformance() {
    const perf = {};
    students.forEach((student) => {
      assignments.forEach((assignment) => {
        assignment.questions.forEach((q) => {
          const val = grades[student.id] && grades[student.id][assignment.id] && grades[student.id][assignment.id][q.id];
          if (typeof val === 'number') {
            if (!perf[q.topic]) perf[q.topic] = { points: 0, max: 0 };
            perf[q.topic].points += val;
            perf[q.topic].max += Number(q.maxPoints);
          }
        });
      });
    });
    return perf;
  }

  // Compute average performance by gender. Returns an object where keys are gender labels
  // (e.g., 'Male', 'Female', 'Non‑binary', 'Prefer not to say', or 'Unspecified')
  // and values are objects { points, max } summarizing the total points earned and
  // total maximum points for students of that gender across all assignments.
  function computeGenderAverages() {
    const perf = {};
    students.forEach((student) => {
      const g = student.gender || 'Unspecified';
      if (!perf[g]) perf[g] = { points: 0, max: 0, count: 0 };
      perf[g].count += 1;
      assignments.forEach((assignment) => {
        assignment.questions.forEach((q) => {
          const val = grades[student.id] && grades[student.id][assignment.id] && grades[student.id][assignment.id][q.id];
          if (typeof val === 'number') {
            perf[g].points += val;
            perf[g].max += Number(q.maxPoints);
          }
        });
      });
    });
    return perf;
  }

  /**
   * Compute average performance by section (or class). Each student may belong to a
   * section (provided via the optional "Section" input). This function
   * accumulates total points and maximum points for all students within each
   * section across every assignment and question. It also tracks how many
   * students are in each section. Students without a specified section are
   * grouped under the label "Unspecified".
   */
  function computeSectionAverages() {
    const perf = {};
    students.forEach((student) => {
      const sect = student.section || 'Unspecified';
      if (!perf[sect]) perf[sect] = { points: 0, max: 0, count: 0 };
      perf[sect].count += 1;
      assignments.forEach((assignment) => {
        assignment.questions.forEach((q) => {
          const val = grades[student.id] && grades[student.id][assignment.id] && grades[student.id][assignment.id][q.id];
          if (typeof val === 'number') {
            perf[sect].points += val;
            perf[sect].max += Number(q.maxPoints);
          }
        });
      });
    });
    return perf;
  }

  // Determine the weakest topic for a student (lowest percentage)
  function getWeakestTopic(studentId) {
    const perf = computeTopicPerformance(studentId);
    let minTopic = null;
    let minRate = Infinity;
    Object.keys(perf).forEach((topic) => {
      const data = perf[topic];
      if (data.max > 0) {
        const rate = data.points / data.max;
        if (rate < minRate) {
          minRate = rate;
          minTopic = topic;
        }
      }
    });
    return minTopic;
  }

  // Generate a support message for a student based on performance metrics and topic performance
  function getSupportMessage(studentId) {
    const avg = computeStudentAverage(studentId);
    const classAvg = computeClassAverage();
    const improvement = computeStudentImprovement(studentId);
    if (avg === null) {
      return 'No grades recorded yet.';
    }
    let parts = [];
    if (classAvg !== null) {
      const diff = avg - classAvg;
      if (diff < -1e-6) {
        parts.push('Below class average.');
      } else if (diff > 1e-6) {
        parts.push('Above class average.');
      } else {
        parts.push('At class average.');
      }
    }
    if (improvement !== null) {
      if (improvement < -5) {
        parts.push('Performance is declining. Consider additional support.');
      } else if (improvement > 5) {
        parts.push('Performance is improving. Encourage continued effort.');
      } else {
        parts.push('Performance is stable.');
      }
    } else {
      parts.push('Not enough data to assess improvement.');
    }
    // Identify weakest topic and include advice
    const weakTopic = getWeakestTopic(studentId);
    if (weakTopic) {
      parts.push(`Weakest topic: ${weakTopic}. Provide targeted practice.`);
    }
    return parts.join(' ');
  }

  // Render performance analysis for each student
  function renderAnalysis() {
    const container = document.getElementById('analysis-container');
    container.innerHTML = '';
    if (students.length === 0 || assignments.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Add students and assignments to see analysis.';
      container.appendChild(p);
      return;
    }
    // Build a table: Student, Average (%), Difference from class, Improvement (%), Recommendation
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Student', 'Average (%)', 'Difference from class', 'Improvement (%)', 'Recommendation'].forEach((heading) => {
      const th = document.createElement('th');
      th.textContent = heading;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const classAvg = computeClassAverage();
    students.forEach((student) => {
      const tr = document.createElement('tr');
      const avg = computeStudentAverage(student.id);
      const improvement = computeStudentImprovement(student.id);
      // Student name
      let td = document.createElement('td');
      td.textContent = student.name;
      tr.appendChild(td);
      // Average
      td = document.createElement('td');
      td.textContent = avg === null ? '-' : avg.toFixed(2);
      tr.appendChild(td);
      // Difference from class average
      td = document.createElement('td');
      if (avg === null || classAvg === null) {
        td.textContent = '-';
      } else {
        const diff = avg - classAvg;
        td.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(2);
      }
      tr.appendChild(td);
      // Improvement
      td = document.createElement('td');
      if (improvement === null) {
        td.textContent = '-';
      } else {
        td.textContent = (improvement >= 0 ? '+' : '') + improvement.toFixed(2);
      }
      tr.appendChild(td);
      // Recommendation
      td = document.createElement('td');
      td.textContent = getSupportMessage(student.id);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // Render topic-level analysis for each student and class
  function renderTopicAnalysis() {
    const container = document.getElementById('topic-analysis-container');
    container.innerHTML = '';
    if (students.length === 0 || assignments.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Add students and assignments to see topic analysis.';
      container.appendChild(p);
      return;
    }
    // Gather all unique topics
    const allTopics = new Set();
    assignments.forEach((assignment) => {
      assignment.questions.forEach((q) => allTopics.add(q.topic));
    });
    const topics = Array.from(allTopics);
    if (topics.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No topics defined yet.';
      container.appendChild(p);
      return;
    }
    // Compute class topic performance
    const classPerf = computeClassTopicPerformance();
    // Table header: Student, for each topic show Student %, Class %, Diff
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.textContent = 'Student';
    headerRow.appendChild(th0);
    topics.forEach((topic) => {
      const th = document.createElement('th');
      th.innerHTML = `${topic}<br>(Student / Class / Δ)`;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    students.forEach((student) => {
      const tr = document.createElement('tr');
      let td = document.createElement('td');
      td.textContent = student.name;
      tr.appendChild(td);
      const studentPerf = computeTopicPerformance(student.id);
      topics.forEach((topic) => {
        td = document.createElement('td');
        const sp = studentPerf[topic] || { points: 0, max: 0 };
        const cp = classPerf[topic] || { points: 0, max: 0 };
        let sPct = '-';
        let cPct = '-';
        let diff = '-';
        if (sp.max > 0) {
          sPct = ((sp.points / sp.max) * 100).toFixed(1);
        }
        if (cp.max > 0) {
          cPct = ((cp.points / cp.max) * 100).toFixed(1);
        }
        if (sp.max > 0 && cp.max > 0) {
          const sd = (sp.points / sp.max) * 100;
          const cd = (cp.points / cp.max) * 100;
          diff = ((sd - cd) >= 0 ? '+' : '') + (sd - cd).toFixed(1);
        }
        td.textContent = `${sPct === '-' ? '-' : sPct + '%'} / ${cPct === '-' ? '-' : cPct + '%'} / ${diff}`;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // Render gender-based analysis summarizing average performance by gender
  function renderGenderAnalysis() {
    const container = document.getElementById('gender-analysis-container');
    if (!container) return;
    container.innerHTML = '';
    if (students.length === 0 || assignments.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Add students and assignments to see gender analysis.';
      container.appendChild(p);
      return;
    }
    const perf = computeGenderAverages();
    const classAvg = computeClassAverage();
    // Build a table: Gender, Students, Average (%), Difference from class
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Gender', 'Students', 'Average (%)', 'Difference vs class'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    Object.keys(perf).forEach((gender) => {
      const data = perf[gender];
      const tr = document.createElement('tr');
      let td = document.createElement('td');
      td.textContent = gender;
      tr.appendChild(td);
      // number of students
      td = document.createElement('td');
      td.textContent = data.count;
      tr.appendChild(td);
      // average percentage
      td = document.createElement('td');
      if (data.max > 0) {
        const pct = (data.points / data.max) * 100;
        td.textContent = pct.toFixed(2);
      } else {
        td.textContent = '-';
      }
      tr.appendChild(td);
      // difference from class average
      td = document.createElement('td');
      if (data.max > 0 && classAvg !== null) {
        const pct = (data.points / data.max) * 100;
        const diff = pct - classAvg;
        td.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(2);
      } else {
        td.textContent = '-';
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  /**
   * Render section-based analysis summarizing average performance by section.
   * Displays a table showing each section, the number of students in the section,
   * the average percentage score across all assignments and questions, and the
   * difference relative to the overall class average. This helps teachers
   * identify which class sections may need additional support.
   */
  function renderSectionAnalysis() {
    const container = document.getElementById('section-analysis-container');
    if (!container) return;
    container.innerHTML = '';
    // Only render analysis if there are students and assignments
    if (students.length === 0 || assignments.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Add students and assignments to see section analysis.';
      container.appendChild(p);
      return;
    }
    const perf = computeSectionAverages();
    const classAvg = computeClassAverage();
    // Build table header
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Section', 'Students', 'Average (%)', 'Difference vs class'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    Object.keys(perf).forEach((sect) => {
      const data = perf[sect];
      const tr = document.createElement('tr');
      let td = document.createElement('td');
      td.textContent = sect;
      tr.appendChild(td);
      td = document.createElement('td');
      td.textContent = data.count;
      tr.appendChild(td);
      td = document.createElement('td');
      if (data.max > 0) {
        const pct = (data.points / data.max) * 100;
        td.textContent = pct.toFixed(2);
      } else {
        td.textContent = '-';
      }
      tr.appendChild(td);
      td = document.createElement('td');
      if (data.max > 0 && classAvg !== null) {
        const pct = (data.points / data.max) * 100;
        const diff = pct - classAvg;
        td.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(2);
      } else {
        td.textContent = '-';
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // Render functions
  function renderStudentsList() {
    const list = document.getElementById('students-list');
    list.innerHTML = '';
    students.forEach((student) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      // Display name with optional gender and section information
      const nameParts = [];
      nameParts.push(student.name);
      if (student.gender) {
        nameParts.push(`Gender: ${student.gender}`);
      }
      if (student.section) {
        nameParts.push(`Section: ${student.section}`);
      }
      span.textContent = nameParts.join(' | ');
      li.appendChild(span);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'delete-btn';
      delBtn.addEventListener('click', () => {
        if (confirm(`Delete student "${student.name}"?`)) {
          deleteStudent(student.id);
        }
      });
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  function renderAssignmentsList() {
    const list = document.getElementById('assignments-list');
    list.innerHTML = '';
    assignments.forEach((assignment) => {
      const li = document.createElement('li');
      const info = document.createElement('span');
      const numQ = assignment.questions.length;
      info.textContent = `${assignment.title} [${assignment.subject}] – ${numQ} question${numQ !== 1 ? 's' : ''}`;
      li.appendChild(info);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'delete-btn';
      delBtn.addEventListener('click', () => {
        if (confirm(`Delete assignment "${assignment.title}"?`)) {
          deleteAssignment(assignment.id);
        }
      });
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  function renderGradesTable() {
    const container = document.getElementById('grades-table-container');
    container.innerHTML = '';
    if (students.length === 0 || assignments.length === 0) {
      const message = document.createElement('p');
      message.textContent = 'Add students and assignments to enter grades.';
      container.appendChild(message);
      return;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    // First header cell for student names
    const blankTh = document.createElement('th');
    blankTh.textContent = 'Student';
    headerRow.appendChild(blankTh);
    // Header cells for each question of each assignment
    assignments.forEach((assignment) => {
      assignment.questions.forEach((q, idx) => {
        const th = document.createElement('th');
        // Display assignment title and question number with topic
        th.innerHTML = `${assignment.title}<br>Q${idx + 1} (${q.topic})`;
        headerRow.appendChild(th);
      });
    });
    // Average column
    const avgTh = document.createElement('th');
    avgTh.textContent = 'Average (%)';
    headerRow.appendChild(avgTh);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    students.forEach((student) => {
      const tr = document.createElement('tr');
      // Student name
      const nameTd = document.createElement('td');
      nameTd.textContent = student.name;
      tr.appendChild(nameTd);
      // Inputs for each question
      assignments.forEach((assignment) => {
        assignment.questions.forEach((q) => {
          const td = document.createElement('td');
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'grade-input';
          input.min = '0';
          input.max = q.maxPoints;
          // Pre-fill existing value
          const currentVal = grades[student.id] && grades[student.id][assignment.id] && grades[student.id][assignment.id][q.id];
          if (typeof currentVal === 'number') {
            input.value = currentVal;
          }
          input.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === '') {
              updateGrade(student.id, assignment.id, q.id, null);
            } else {
              const num = parseFloat(val);
              if (isNaN(num) || num < 0) {
                e.target.value = '';
                updateGrade(student.id, assignment.id, q.id, null);
              } else if (num > q.maxPoints) {
                alert(`Grade cannot exceed maximum points (${q.maxPoints}).`);
                e.target.value = q.maxPoints;
                updateGrade(student.id, assignment.id, q.id, q.maxPoints);
              } else {
                updateGrade(student.id, assignment.id, q.id, num);
              }
            }
          });
          td.appendChild(input);
          tr.appendChild(td);
        });
      });
      // Average column
      const avgTd = document.createElement('td');
      const avgVal = computeStudentAverage(student.id);
      avgTd.textContent = avgVal === null ? '-' : avgVal.toFixed(2);
      tr.appendChild(avgTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderSummary() {
    const container = document.getElementById('summary-container');
    container.innerHTML = '';
    if (students.length === 0 || assignments.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Add students and assignments to see summary.';
      container.appendChild(p);
      return;
    }
    // Compute averages
    const data = students.map((student) => {
      return {
        name: student.name,
        average: computeStudentAverage(student.id),
      };
    });
    // Filter out students without any grades
    const filtered = data.filter((d) => d.average !== null);
    if (filtered.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No grades entered yet.';
      container.appendChild(p);
      return;
    }
    // Sort by average descending
    filtered.sort((a, b) => b.average - a.average);
    const list = document.createElement('ol');
    filtered.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.name} – ${item.average.toFixed(2)}%`;
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  // Chart.js chart objects to persist and update
  let assignmentChart = null;
  let topicChart = null;
  let genderChart = null;

  // Render bar and topic charts
  function renderCharts() {
    // If Chart.js is not available (e.g., due to network issues loading the CDN),
    // skip rendering charts to avoid breaking other features. This ensures that
    // students and assignments can still be managed even if charts cannot be drawn.
    if (typeof Chart === 'undefined') {
      return;
    }
    // Render assignment-level chart (class average per assignment)
    const ctxAssign = document.getElementById('assignment-chart').getContext('2d');
    // Compute class average per assignment
    const assignLabels = [];
    const assignValues = [];
    assignments.forEach((assignment) => {
      let points = 0;
      let maxPoints = 0;
      assignment.questions.forEach((q) => {
        const qMax = Number(q.maxPoints);
        students.forEach((student) => {
          const val = grades[student.id] && grades[student.id][assignment.id] && grades[student.id][assignment.id][q.id];
          if (typeof val === 'number') {
            points += val;
            maxPoints += qMax;
          }
        });
      });
      if (maxPoints > 0) {
        assignLabels.push(assignment.title);
        assignValues.push((points / maxPoints) * 100);
      } else {
        assignLabels.push(assignment.title);
        assignValues.push(0);
      }
    });
    // Destroy existing chart if it exists
    if (assignmentChart) assignmentChart.destroy();
    assignmentChart = new Chart(ctxAssign, {
      type: 'bar',
      data: {
        labels: assignLabels,
        datasets: [
          {
            label: 'Class Average (%)',
            data: assignValues,
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true
          },
          title: {
            display: true,
            text: 'Class Average by Assignment'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    });
    // Render topic-level chart (class average per topic)
    const ctxTopic = document.getElementById('topic-chart').getContext('2d');
    const classPerf = computeClassTopicPerformance();
    const topicLabels = [];
    const topicValues = [];
    Object.keys(classPerf).forEach((topic) => {
      const p = classPerf[topic];
      if (p.max > 0) {
        topicLabels.push(topic);
        topicValues.push((p.points / p.max) * 100);
      }
    });
    if (topicChart) topicChart.destroy();
    topicChart = new Chart(ctxTopic, {
      type: 'bar',
      data: {
        labels: topicLabels,
        datasets: [
          {
            label: 'Class Average (%)',
            data: topicValues,
            backgroundColor: 'rgba(255, 159, 64, 0.5)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true
          },
          title: {
            display: true,
            text: 'Class Average by Topic'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    });
    // Render individual student topic charts
    const studentChartsContainer = document.getElementById('student-topic-charts');
    studentChartsContainer.innerHTML = '';
    students.forEach((student) => {
      const perf = computeTopicPerformance(student.id);
      const topics = Object.keys(perf);
      if (topics.length === 0) return;
      const div = document.createElement('div');
      div.className = 'chart-wrapper';
      const title = document.createElement('h3');
      title.textContent = `${student.name} Topic Performance`;
      div.appendChild(title);
      const canvas = document.createElement('canvas');
      div.appendChild(canvas);
      studentChartsContainer.appendChild(div);
      const labels = [];
      const values = [];
      topics.forEach((t) => {
        const data = perf[t];
        if (data.max > 0) {
          labels.push(t);
          values.push((data.points / data.max) * 100);
        }
      });
      new Chart(canvas.getContext('2d'), {
        type: 'radar',
        data: {
          labels,
          datasets: [
            {
              label: `${student.name}`,
              data: values,
              backgroundColor: 'rgba(54, 162, 235, 0.2)',
              borderColor: 'rgba(54, 162, 235, 1)',
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          scales: {
            r: {
              beginAtZero: true,
              max: 100
            }
          }
        }
      });
    });

    // Render gender-level chart (average per gender) if canvas exists
    const genderCanvas = document.getElementById('gender-chart');
    if (genderCanvas) {
      const ctxGender = genderCanvas.getContext('2d');
      const genderPerf = computeGenderAverages();
      const genderLabels = [];
      const genderValues = [];
      Object.keys(genderPerf).forEach((g) => {
        const d = genderPerf[g];
        genderLabels.push(g);
        if (d.max > 0) {
          genderValues.push((d.points / d.max) * 100);
        } else {
          genderValues.push(0);
        }
      });
      if (genderChart) genderChart.destroy();
      genderChart = new Chart(ctxGender, {
        type: 'bar',
        data: {
          labels: genderLabels,
          datasets: [
            {
              label: 'Average (%)',
              data: genderValues,
              backgroundColor: 'rgba(153, 102, 255, 0.5)',
              borderColor: 'rgba(153, 102, 255, 1)',
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: true
            },
            title: {
              display: true,
              text: 'Average Score by Gender'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100
            }
          }
        }
      });
    }
  }

  // Generate AI-like summary conclusion
  function generateAIConclusion() {
    if (students.length === 0 || assignments.length === 0) {
      return 'Add students and assignments to generate a summary.';
    }
    const classAvg = computeClassAverage();
    // Identify best and worst students
    let best = null;
    let worst = null;
    students.forEach((student) => {
      const avg = computeStudentAverage(student.id);
      if (avg !== null) {
        if (!best || avg > best.avg) best = { name: student.name, avg };
        if (!worst || avg < worst.avg) worst = { name: student.name, avg };
      }
    });
    // Identify topics with highest and lowest class average
    const classPerf = computeClassTopicPerformance();
    let topTopic = null;
    let topValue = -1;
    let lowTopic = null;
    let lowValue = Infinity;
    Object.keys(classPerf).forEach((topic) => {
      const d = classPerf[topic];
      if (d.max > 0) {
        const pct = (d.points / d.max) * 100;
        if (pct > topValue) {
          topValue = pct;
          topTopic = topic;
        }
        if (pct < lowValue) {
          lowValue = pct;
          lowTopic = topic;
        }
      }
    });
    // Identify students with notable improvement or decline
    const improving = [];
    const declining = [];
    students.forEach((student) => {
      const imp = computeStudentImprovement(student.id);
      if (imp !== null) {
        if (imp > 5) improving.push(student.name);
        else if (imp < -5) declining.push(student.name);
      }
    });
    let parts = [];
    parts.push(`The class average across all topics is ${classAvg !== null ? classAvg.toFixed(2) : 'N/A'}%.`);
    if (best) parts.push(`Top performer: ${best.name} (${best.avg.toFixed(2)}%).`);
    if (worst) parts.push(`Lowest performer: ${worst.name} (${worst.avg.toFixed(2)}%).`);
    if (topTopic !== null) parts.push(`Strongest topic: ${topTopic} (${topValue.toFixed(2)}%).`);
    if (lowTopic !== null) parts.push(`Weakest topic: ${lowTopic} (${lowValue.toFixed(2)}%).`);
    if (improving.length > 0) parts.push(`Students showing improvement: ${improving.join(', ')}.`);
    if (declining.length > 0) parts.push(`Students showing decline: ${declining.join(', ')}. They may need extra support.`);
    // Gender average comparison: if multiple gender groups exist
    const genderPerf = computeGenderAverages();
    const genderAverages = [];
    Object.keys(genderPerf).forEach((g) => {
      const d = genderPerf[g];
      if (d.max > 0) {
        genderAverages.push({ gender: g, avg: (d.points / d.max) * 100 });
      }
    });
    if (genderAverages.length >= 2) {
      // Sort by average descending
      genderAverages.sort((a, b) => b.avg - a.avg);
      const topG = genderAverages[0];
      const bottomG = genderAverages[genderAverages.length - 1];
      const diff = topG.avg - bottomG.avg;
      const genderParts = genderAverages.map((ga) => `${ga.gender}: ${ga.avg.toFixed(2)}%`);
      parts.push(`Average by gender – ${genderParts.join(', ')}. Difference between ${topG.gender} and ${bottomG.gender} is ${diff.toFixed(2)}%.`);
    }

    // Section average comparison: highlight differences between class sections
    const sectionPerf = computeSectionAverages();
    const sectionAverages = [];
    Object.keys(sectionPerf).forEach((sect) => {
      const d = sectionPerf[sect];
      if (d.max > 0) {
        sectionAverages.push({ section: sect, avg: (d.points / d.max) * 100 });
      }
    });
    if (sectionAverages.length >= 2) {
      sectionAverages.sort((a, b) => b.avg - a.avg);
      const topS = sectionAverages[0];
      const bottomS = sectionAverages[sectionAverages.length - 1];
      const sDiff = topS.avg - bottomS.avg;
      const sParts = sectionAverages.map((sa) => `${sa.section}: ${sa.avg.toFixed(2)}%`);
      parts.push(`Average by section – ${sParts.join(', ')}. Difference between ${topS.section} and ${bottomS.section} is ${sDiff.toFixed(2)}%.`);
    }
    if (parts.length === 0) return 'Not enough data for summary.';
    return parts.join(' ');
  }

  // Render all sections
  function renderAll() {
    renderStudentsList();
    renderAssignmentsList();
    renderGradesTable();
    renderSummary();
    renderAnalysis();
    renderTopicAnalysis();
    renderGenderAnalysis();
    renderSectionAnalysis();
    renderCharts();
  }

  // Event handlers for forms and buttons
  function attachEventHandlers() {
    // Set up the student form to call the global uiAddStudent() when submitted (e.g., hitting Enter)
    const studentForm = document.getElementById('student-form');
    studentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Use global function to ensure section is captured and state updates
      if (typeof window.uiAddStudent === 'function') {
        window.uiAddStudent();
      }
    });

    // Ensure the Add Student button triggers the global uiAddStudent function when clicked.
    const addStudentBtn = document.getElementById('add-student-btn');
    if (addStudentBtn) {
      addStudentBtn.addEventListener('click', () => {
        if (typeof window.uiAddStudent === 'function') {
          window.uiAddStudent();
        }
      });
    }
    // Handle adding questions dynamically
    const addQBtn = document.getElementById('add-question-btn');
    addQBtn.addEventListener('click', () => {
      const container = document.getElementById('questions-container');
      const row = document.createElement('div');
      row.className = 'question-row';
      const qText = document.createElement('input');
      qText.type = 'text';
      qText.placeholder = 'Question text';
      qText.className = 'question-text';
      qText.required = true;
      const qMax = document.createElement('input');
      qMax.type = 'number';
      qMax.placeholder = 'Max points';
      qMax.min = '1';
      qMax.className = 'question-max';
      qMax.required = true;
      const qTopic = document.createElement('input');
      qTopic.type = 'text';
      qTopic.placeholder = 'Topic';
      qTopic.className = 'question-topic';
      qTopic.required = true;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.className = 'remove-question-btn';
      removeBtn.addEventListener('click', () => {
        row.remove();
      });
      row.appendChild(qText);
      row.appendChild(qMax);
      row.appendChild(qTopic);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
    const assignmentForm = document.getElementById('assignment-form');
    assignmentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('assignment-title');
      const subjectInput = document.getElementById('assignment-subject');
      const title = titleInput.value.trim();
      const subject = subjectInput.value.trim();
      // Gather questions
      const rows = Array.from(document.querySelectorAll('#questions-container .question-row'));
      const questions = [];
      let valid = true;
      rows.forEach((row) => {
        const textEl = row.querySelector('.question-text');
        const maxEl = row.querySelector('.question-max');
        const topicEl = row.querySelector('.question-topic');
        const qTextVal = textEl.value.trim();
        const qMaxVal = parseFloat(maxEl.value);
        const qTopicVal = topicEl.value.trim() || 'General';
        if (!qTextVal || isNaN(qMaxVal) || qMaxVal <= 0) {
          valid = false;
        } else {
          questions.push({ id: generateId('q'), text: qTextVal, maxPoints: qMaxVal, topic: qTopicVal });
        }
      });
      if (!title || !subject || questions.length === 0 || !valid) {
        alert('Please provide a title, subject, and at least one valid question with positive max points.');
        return;
      }
      addAssignment(title, subject, questions);
      // Clear form inputs
      titleInput.value = '';
      subjectInput.value = '';
      // Remove question rows
      document.getElementById('questions-container').innerHTML = '';
    });
    // AI conclusion button
    const conclusionBtn = document.getElementById('generate-conclusion-btn');
    conclusionBtn.addEventListener('click', () => {
      const summary = generateAIConclusion();
      const container = document.getElementById('ai-conclusion-container');
      container.textContent = summary;
    });
  }

  // Initialize the app
  function init() {
    loadData();
    attachEventHandlers();
    // Set current year in footer
    document.getElementById('year').textContent = new Date().getFullYear();
    renderAll();
  }

  // Run init on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);

  // Expose a global function to handle adding a student. This is used as an
  // onclick handler in the HTML. By binding through the window object we
  // bypass potential issues with file:// event listeners not firing. It
  // simply reads the input values, invokes the internal addStudent function,
  // and resets the form fields.
  window.uiAddStudent = function () {
    const nameInput = document.getElementById('student-name');
    const genderSelect = document.getElementById('student-gender');
    const sectionInput = document.getElementById('student-section');
    const name = nameInput.value ? nameInput.value.trim() : '';
    const gender = genderSelect ? genderSelect.value : '';
    const section = sectionInput ? sectionInput.value.trim() : '';
    if (name) {
      // Use the internal addStudent function defined in this closure.
      addStudent(name, gender, section);
      // Clear input fields
      nameInput.value = '';
      if (genderSelect) genderSelect.selectedIndex = 0;
      if (sectionInput) sectionInput.value = '';
    }
  };

  /**
   * Import students from a file (CSV or Excel).
   * The file should contain rows of data: the first column is the student name.
   * Optional columns for gender and section follow. This function will read
   * the file using FileReader. If the file is an Excel sheet (.xlsx/.xls) and
   * the `readXlsxFile` global function (from the read-excel-file library) is
   * available, it will use that; otherwise it falls back to CSV parsing.
   */
  window.uiImportStudents = function () {
    const input = document.getElementById('student-upload-file');
    if (!input || !input.files || input.files.length === 0) {
      alert('Please select a file to import students.');
      return;
    }
    const file = input.files[0];
    const fileName = file.name.toLowerCase();
    const ext = fileName.split('.').pop();
    const processRows = (rows) => {
      // Skip header row if it seems like a header (non-empty strings and not numbers)
      rows.forEach((row, idx) => {
        if (!row || row.length === 0) return;
        // Trim each cell value
        const [nameRaw, genderRaw, sectionRaw] = row;
        if (idx === 0) {
          // If header row (e.g., "Name"), detect by checking if name cell contains letters and not digits
          const cell = String(nameRaw || '').toLowerCase();
          if (cell.includes('name') || cell.includes('student')) {
            return;
          }
        }
        const name = (nameRaw || '').toString().trim();
        if (!name) return;
        const gender = (genderRaw || '').toString().trim();
        const section = (sectionRaw || '').toString().trim();
        addStudent(name, gender, section);
      });
      // Clear file input
      input.value = '';
      alert('Students imported successfully.');
    };
    if (ext === 'xlsx' || ext === 'xls') {
      // Try to use readXlsxFile if available
      if (typeof readXlsxFile === 'function') {
        readXlsxFile(file)
          .then((rows) => {
            processRows(rows);
          })
          .catch((err) => {
            console.error(err);
            alert('Failed to parse Excel file. Please convert it to CSV or ensure the file format is correct.');
          });
        return;
      } else {
        alert('Excel import library is not available. Please convert the file to CSV format.');
        return;
      }
    }
    // Fallback: parse as CSV
    const reader = new FileReader();
    reader.onload = function (e) {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const rows = lines.map((line) => line.split(','));
      processRows(rows);
    };
    reader.onerror = function () {
      alert('Failed to read the file.');
    };
    reader.readAsText(file);
  };

  /**
   * Import questions from a file (CSV or Excel) into the current assignment form.
   * Each row should contain: question text, max points, topic. The first
   * row can optionally be a header. This function will create question rows
   * inside the assignment form based on the imported data.
   */
  window.uiImportQuestions = function () {
    const input = document.getElementById('question-upload-file');
    if (!input || !input.files || input.files.length === 0) {
      alert('Please select a file to import questions.');
      return;
    }
    const file = input.files[0];
    const fileName = file.name.toLowerCase();
    const ext = fileName.split('.').pop();
    const container = document.getElementById('questions-container');
    if (!container) return;
    const addRows = (rows) => {
      rows.forEach((row, idx) => {
        if (!row || row.length === 0) return;
        let [textRaw, maxRaw, topicRaw] = row;
        if (idx === 0) {
          // Skip header row if first cell looks like a header label
          const cell = String(textRaw || '').toLowerCase();
          if (cell.includes('question') || cell.includes('text')) {
            return;
          }
        }
        const text = (textRaw || '').toString().trim();
        const max = parseFloat(maxRaw);
        const topic = (topicRaw || '').toString().trim() || 'General';
        if (!text || isNaN(max) || max <= 0) return;
        // Create a new question row in the form
        const rowEl = document.createElement('div');
        rowEl.className = 'question-row';
        const qText = document.createElement('input');
        qText.type = 'text';
        qText.placeholder = 'Question text';
        qText.className = 'question-text';
        qText.value = text;
        qText.required = true;
        const qMax = document.createElement('input');
        qMax.type = 'number';
        qMax.placeholder = 'Max points';
        qMax.className = 'question-max';
        qMax.min = '1';
        qMax.value = max;
        qMax.required = true;
        const qTopic = document.createElement('input');
        qTopic.type = 'text';
        qTopic.placeholder = 'Topic';
        qTopic.className = 'question-topic';
        qTopic.value = topic;
        qTopic.required = true;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.className = 'remove-question-btn';
        removeBtn.addEventListener('click', () => {
          rowEl.remove();
        });
        rowEl.appendChild(qText);
        rowEl.appendChild(qMax);
        rowEl.appendChild(qTopic);
        rowEl.appendChild(removeBtn);
        container.appendChild(rowEl);
      });
      input.value = '';
      alert('Questions imported successfully.');
    };
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof readXlsxFile === 'function') {
        readXlsxFile(file)
          .then((rows) => {
            addRows(rows);
          })
          .catch((err) => {
            console.error(err);
            alert('Failed to parse Excel file. Please convert it to CSV or ensure the file format is correct.');
          });
        return;
      } else {
        alert('Excel import library is not available. Please convert the file to CSV format.');
        return;
      }
    }
    // Fallback: parse CSV
    const reader = new FileReader();
    reader.onload = function (e) {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const rows = lines.map((line) => line.split(','));
      addRows(rows);
    };
    reader.onerror = function () {
      alert('Failed to read the file.');
    };
    reader.readAsText(file);
  };
})();