const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(require("express").static(require("path").join(__dirname, "public")));
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Status: ${res.statusCode}`);
  next();
});

// Database setup
const dbPath = '/data/macro_tracker.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
    initializeDatabase();
  }
});

function calculateBaseGoals(profile) {
  const { age, weight_kg, height_cm, gender, activity_level, goal } = profile;

  if (!age || !weight_kg || !height_cm || !gender || !activity_level || !goal) {
    return {
      base_calories: 2000, base_protein: 150, base_carbs: 200, base_fat: 67
    };
  }

  // Mifflin-St Jeor Equation
  let bmr;
  if (gender === 'male') {
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5;
  } else { // female
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
  }

  // Activity level multipliers
  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };
  
  const tdee = bmr * (activityMultipliers[activity_level] || 1.55);

  // Adjust calories based on goal
  let calorieGoal;
  switch (goal) {
    case 'lose': calorieGoal = tdee - 500; break;
    case 'gain': calorieGoal = tdee + 500; break;
    default: calorieGoal = tdee;
  }

  // Calculate macros
  const proteinGrams = Math.round(weight_kg * 1.8); // 1.8g per kg bodyweight
  const proteinCalories = proteinGrams * 4;
  const fatCalories = Math.round(calorieGoal * 0.25); // 25% of calories from fat
  const fatGrams = Math.round(fatCalories / 9);
  const carbCalories = calorieGoal - proteinCalories - fatCalories;
  const carbGrams = Math.round(carbCalories / 4);

  return {
    base_calories: Math.round(calorieGoal),
    base_protein: proteinGrams,
    base_carbs: Math.max(carbGrams, 0),
    base_fat: fatGrams
  };
}

function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT 'User',
      age INTEGER DEFAULT 30,
      weight_kg REAL DEFAULT 70,
      height_cm REAL DEFAULT 170,
      gender TEXT DEFAULT 'male' CHECK(gender IN ('male', 'female')),
      activity_level TEXT DEFAULT 'moderate' CHECK(activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
      goal TEXT DEFAULT 'maintain' CHECK(goal IN ('lose', 'maintain', 'gain')),
      base_calories INTEGER,
      base_protein INTEGER,
      base_carbs INTEGER,
      base_fat INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Foods table
    db.run(`CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      description TEXT NOT NULL,
      calories REAL NOT NULL,
      protein REAL DEFAULT 0,
      carbs REAL DEFAULT 0,
      fat REAL DEFAULT 0,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Activities table
    db.run(`CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      duration INTEGER NOT NULL,
      calories_burned REAL NOT NULL,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Create default user if doesn't exist
    db.get('SELECT id FROM users WHERE id = 1', (err, row) => {
      if (!row) {
        const defaultProfile = {
          age: 30,
          weight_kg: 70,
          height_cm: 170,
          gender: 'male',
          activity_level: 'moderate',
          goal: 'maintain'
        };
        const goals = calculateBaseGoals(defaultProfile);
        
        db.run(`INSERT INTO users (id, name, age, weight_kg, height_cm, gender, activity_level, goal, base_calories, base_protein, base_carbs, base_fat) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [1, 'User', defaultProfile.age, defaultProfile.weight_kg, defaultProfile.height_cm, 
                 defaultProfile.gender, defaultProfile.activity_level, defaultProfile.goal, 
                 goals.base_calories, goals.base_protein, goals.base_carbs, goals.base_fat],
                (err) => {
                  if (err) console.error('Error creating default user:', err);
                  else console.log('Created default user with calculated macro goals');
                });
      }
    });
  });
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// Get user profile
app.get('/api/user', (req, res) => {
  db.get('SELECT * FROM users WHERE id = 1', (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(row || {});
  });
});

// Update user profile
app.put('/api/user', (req, res) => {
  const { name, age, weight_kg, height_cm, gender, activity_level, goal } = req.body;
  const goals = calculateBaseGoals(req.body);
  
  console.log('Updating user profile with calculated goals:', goals);
  
  db.run(
    `UPDATE users SET name = ?, age = ?, weight_kg = ?, height_cm = ?, gender = ?, activity_level = ?, goal = ?, 
     base_calories = ?, base_protein = ?, base_carbs = ?, base_fat = ? WHERE id = 1`,
    [name, age, weight_kg, height_cm, gender, activity_level, goal, 
     goals.base_calories, goals.base_protein, goals.base_carbs, goals.base_fat],
    function(err) {
      if (err) {
        console.error('Error updating user:', err);
        return res.status(500).json({ error: err.message });
      }
      console.log(`User profile updated successfully, changes: ${this.changes}`);
      res.json({ message: 'User updated successfully', goals });
    }
  );
});

// Get today's data with intelligent goal adjustment
app.get('/api/today', (req, res) => {
  const today = getTodayDate();
  
  db.get('SELECT * FROM users WHERE id = 1', (err, user) => {
    if (err || !user) {
      console.error('User fetch error:', err);
      return res.status(500).json({ error: err ? err.message : 'User not found' });
    }
    
    db.all('SELECT * FROM foods WHERE user_id = 1 AND date = ? ORDER BY created_at DESC', [today], (err, foods) => {
      if (err) {
        console.error('Foods fetch error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      db.all('SELECT * FROM activities WHERE user_id = 1 AND date = ? ORDER BY created_at DESC', [today], (err, activities) => {
        if (err) {
          console.error('Activities fetch error:', err);
          return res.status(500).json({ error: err.message });
        }
        
        // Calculate total calories burned today
        const totalCaloriesBurned = (activities || []).reduce((sum, act) => sum + (act.calories_burned || 0), 0);
        
        // Intelligent goal adjustment based on activity
        const adjustedGoals = {
          calories: (user.base_calories || 2000) + totalCaloriesBurned,
          protein: (user.base_protein || 150) + Math.round(totalCaloriesBurned * 0.15 / 4), // 15% of burned calories as protein
          carbs: (user.base_carbs || 200) + Math.round(totalCaloriesBurned * 0.5 / 4), // 50% of burned calories as carbs
          fat: (user.base_fat || 67) + Math.round(totalCaloriesBurned * 0.35 / 9) // 35% of burned calories as fat
        };
        
        console.log(`Today's data: ${(foods || []).length} foods, ${(activities || []).length} activities, ${totalCaloriesBurned} calories burned`);
        
        res.json({
          foods: foods || [],
          activities: activities || [],
          baseGoals: {
            calories: user.base_calories || 2000,
            protein: user.base_protein || 150,
            carbs: user.base_carbs || 200,
            fat: user.base_fat || 67
          },
          adjustedGoals,
          totalCaloriesBurned
        });
      });
    });
  });
});

// Add food
app.post('/api/foods', (req, res) => {
  const { description, calories, protein, carbs, fat } = req.body;
  
  if (!description || !calories || calories <= 0) {
    return res.status(400).json({ error: 'Description and valid calories are required' });
  }
  
  const today = getTodayDate();
  
  db.run(
    'INSERT INTO foods (user_id, description, calories, protein, carbs, fat, date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1, description, calories, protein || 0, carbs || 0, fat || 0, today],
    function(err) {
      if (err) {
        console.error('Error adding food:', err);
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT * FROM foods WHERE id = ?', [this.lastID], (err, row) => {
        if (err) {
          console.error('Error fetching added food:', err);
          return res.status(500).json({ error: err.message });
        }
        console.log(`Added food: ${description} (${calories} cal)`);
        res.status(201).json(row);
      });
    }
  );
});

// Add activity
app.post('/api/activities', (req, res) => {
  const { name, duration, calories_burned } = req.body;
  
  if (!name || !duration || !calories_burned || duration <= 0 || calories_burned <= 0) {
    return res.status(400).json({ error: 'Name, valid duration, and calories burned are required' });
  }
  
  const today = getTodayDate();
  
  db.run(
    'INSERT INTO activities (user_id, name, duration, calories_burned, date) VALUES (?, ?, ?, ?, ?)',
    [1, name, duration, calories_burned, today],
    function(err) {
      if (err) {
        console.error('Error adding activity:', err);
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT * FROM activities WHERE id = ?', [this.lastID], (err, row) => {
        if (err) {
          console.error('Error fetching added activity:', err);
          return res.status(500).json({ error: err.message });
        }
        console.log(`Added activity: ${name} (${calories_burned} cal burned)`);
        res.status(201).json(row);
      });
    }
  );
});

// Delete food
app.delete('/api/foods/:id', (req, res) => {
  db.run('DELETE FROM foods WHERE id = ? AND user_id = 1', [req.params.id], function(err) {
    if (err) {
      console.error('Error deleting food:', err);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Food not found' });
    }
    console.log(`Deleted food with ID: ${req.params.id}`);
    res.json({ message: 'Food deleted successfully' });
  });
});

// Delete activity
app.delete('/api/activities/:id', (req, res) => {
  db.run('DELETE FROM activities WHERE id = ? AND user_id = 1', [req.params.id], function(err) {
    if (err) {
      console.error('Error deleting activity:', err);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    console.log(`Deleted activity with ID: ${req.params.id}`);
    res.json({ message: 'Activity deleted successfully' });
  });
});

// Get history (last 7 days)
app.get('/api/history', (req, res) => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startDate = sevenDaysAgo.toISOString().split('T')[0];
  
  db.all(
    `SELECT date, SUM(calories) as total_calories, SUM(protein) as total_protein, 
     SUM(carbs) as total_carbs, SUM(fat) as total_fat 
     FROM foods WHERE user_id = 1 AND date >= ? GROUP BY date ORDER BY date DESC`,
    [startDate],
    (err, foodHistory) => {
      if (err) {
        console.error('Error fetching food history:', err);
        return res.status(500).json({ error: err.message });
      }
      
      db.all(
        `SELECT date, COUNT(*) as activity_count, SUM(calories_burned) as total_burned 
         FROM activities WHERE user_id = 1 AND date >= ? GROUP BY date ORDER BY date DESC`,
        [startDate],
        (err, activityHistory) => {
          if (err) {
            console.error('Error fetching activity history:', err);
            return res.status(500).json({ error: err.message });
          }
          
          console.log(`History: ${(foodHistory || []).length} food days, ${(activityHistory || []).length} activity days`);
          res.json({
            foods: foodHistory || [],
            activities: activityHistory || []
          });
        }
      );
    }
  );
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Macro Tracker server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});