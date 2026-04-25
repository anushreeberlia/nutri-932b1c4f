const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.method === 'POST' && req.body) {
    console.log('Request body:', JSON.stringify(req.body, null, 2));
  }
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

// Helper functions for weight conversion
const kgToLbs = (kg) => kg * 2.20462;
const lbsToKg = (lbs) => lbs / 2.20462;

function calculateBaseGoals(profile) {
  const { age, weight_kg, height_cm, gender, activity_level, goal, target_weight_kg, target_date, body_concerns } = profile;

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

  // Enhanced calorie calculation with target weight and date
  let calorieGoal = tdee;
  
  if (target_weight_kg && target_date && target_weight_kg !== weight_kg) {
    // Calculate time-based calorie adjustment
    const targetDate = new Date(target_date);
    const today = new Date();
    const daysToTarget = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysToTarget > 0) {
      const weightDifference = target_weight_kg - weight_kg; // Positive = gain, negative = lose
      const totalCalorieDeficitOrSurplus = weightDifference * 7700; // 1 kg = ~7700 calories
      const dailyCalorieAdjustment = totalCalorieDeficitOrSurplus / daysToTarget;
      
      // Cap daily adjustment for safety (max 1000 cal deficit/surplus per day)
      const cappedAdjustment = Math.max(-1000, Math.min(1000, dailyCalorieAdjustment));
      
      calorieGoal = tdee + cappedAdjustment;
      console.log(`Target-based calculation: ${weightDifference}kg in ${daysToTarget} days = ${Math.round(cappedAdjustment)} cal/day adjustment`);
    }
  } else {
    // Fallback to basic goal-based calculation
    switch (goal) {
      case 'lose': calorieGoal = tdee - 500; break;
      case 'gain': calorieGoal = tdee + 500; break;
      default: calorieGoal = tdee;
    }
  }

  // Apply body concerns adjustments
  if (body_concerns && Array.isArray(body_concerns)) {
    body_concerns.forEach(concern => {
      switch (concern) {
        case 'high_protein':
          // Increase protein for muscle building/preservation
          break;
        case 'low_carb':
          // Reduce carb percentage for low-carb approach
          break;
        case 'heart_health':
          // Slightly reduce calories for heart health
          calorieGoal = Math.max(1200, calorieGoal * 0.95);
          break;
        case 'diabetes':
          // Focus on steady calorie intake
          break;
        case 'pcos':
          // Lower carb, higher protein approach
          break;
      }
    });
  }

  // Ensure minimum calorie intake for safety
  calorieGoal = Math.max(gender === 'female' ? 1200 : 1500, calorieGoal);

  // Calculate macros based on body concerns and goals
  let proteinPercentage = 0.20; // Default 20%
  let fatPercentage = 0.25; // Default 25%
  let carbPercentage = 0.55; // Default 55%

  if (body_concerns && Array.isArray(body_concerns)) {
    if (body_concerns.includes('high_protein') || body_concerns.includes('muscle_building')) {
      proteinPercentage = 0.30; // 30% protein
      carbPercentage = 0.40; // 40% carbs
      fatPercentage = 0.30; // 30% fat
    }
    if (body_concerns.includes('low_carb') || body_concerns.includes('pcos') || body_concerns.includes('diabetes')) {
      carbPercentage = 0.25; // 25% carbs
      proteinPercentage = 0.30; // 30% protein
      fatPercentage = 0.45; // 45% fat
    }
    if (body_concerns.includes('heart_health')) {
      fatPercentage = 0.20; // 20% fat
      carbPercentage = 0.55; // 55% carbs
      proteinPercentage = 0.25; // 25% protein
    }
  }

  // Calculate macro grams
  const proteinCalories = calorieGoal * proteinPercentage;
  const proteinGrams = Math.round(proteinCalories / 4);
  
  const fatCalories = calorieGoal * fatPercentage;
  const fatGrams = Math.round(fatCalories / 9);
  
  const carbCalories = calorieGoal * carbPercentage;
  const carbGrams = Math.round(carbCalories / 4);

  return {
    base_calories: Math.round(calorieGoal),
    base_protein: proteinGrams,
    base_carbs: carbGrams,
    base_fat: fatGrams
  };
}

function initializeDatabase() {
  db.serialize(() => {
    // Users table with new fields
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT 'User',
      age INTEGER DEFAULT 30,
      weight_kg REAL DEFAULT 70,
      height_cm REAL DEFAULT 170,
      gender TEXT DEFAULT 'male' CHECK(gender IN ('male', 'female')),
      activity_level TEXT DEFAULT 'moderate' CHECK(activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
      goal TEXT DEFAULT 'maintain' CHECK(goal IN ('lose', 'maintain', 'gain')),
      target_weight_kg REAL,
      target_date TEXT,
      body_concerns TEXT,
      base_calories INTEGER,
      base_protein INTEGER,
      base_carbs INTEGER,
      base_fat INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add new columns to existing table if they don't exist
    db.run(`ALTER TABLE users ADD COLUMN target_weight_kg REAL`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding target_weight_kg column:', err.message);
      }
    });
    
    db.run(`ALTER TABLE users ADD COLUMN target_date TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding target_date column:', err.message);
      }
    });
    
    db.run(`ALTER TABLE users ADD COLUMN body_concerns TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding body_concerns column:', err.message);
      }
    });

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

    // Weight entries table
    db.run(`CREATE TABLE IF NOT EXISTS weight_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 1,
      weight_kg REAL NOT NULL,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      UNIQUE(user_id, date)
    )`);

    // Create default user if doesn't exist
    db.get('SELECT id FROM users WHERE id = 1', (err, row) => {
      if (!row) {
        const defaultProfile = {
          age: 30,
          weight_kg: lbsToKg(155), // Convert 155 lbs to kg
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

// Helper function to get today's date consistently
// Accept client date and validate it, or use server date as fallback
function validateAndGetDate(clientDate) {
  if (clientDate && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)) {
    console.log('Using client-provided date:', clientDate);
    return clientDate;
  }
  
  // Server fallback - get local date in YYYY-MM-DD format
  const now = new Date();
  const serverDate = now.getFullYear() + '-' + 
         String(now.getMonth() + 1).padStart(2, '0') + '-' + 
         String(now.getDate()).padStart(2, '0');
  console.log('Using server date as fallback:', serverDate);
  return serverDate;
}

// Get user profile
app.get('/api/user', (req, res) => {
  db.get('SELECT * FROM users WHERE id = 1', (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });
    }
    
    if (row && row.body_concerns) {
      try {
        row.body_concerns = JSON.parse(row.body_concerns);
      } catch (e) {
        row.body_concerns = [];
      }
    }
    
    res.json(row || {});
  });
});

// Update user profile
app.put('/api/user', (req, res) => {
  const { name, age, weight_kg, height_cm, gender, activity_level, goal, target_weight_kg, target_date, body_concerns } = req.body;
  const goals = calculateBaseGoals(req.body);
  
  console.log('Updating user profile with calculated goals:', goals);
  
  // Convert body_concerns array to JSON string
  const bodyConcernsJson = body_concerns ? JSON.stringify(body_concerns) : null;
  
  db.run(
    `UPDATE users SET name = ?, age = ?, weight_kg = ?, height_cm = ?, gender = ?, activity_level = ?, goal = ?, 
     target_weight_kg = ?, target_date = ?, body_concerns = ?, 
     base_calories = ?, base_protein = ?, base_carbs = ?, base_fat = ? WHERE id = 1`,
    [name, age, weight_kg, height_cm, gender, activity_level, goal, 
     target_weight_kg, target_date, bodyConcernsJson,
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

// Get weight entries
app.get('/api/weight', (req, res) => {
  db.all(
    'SELECT * FROM weight_entries WHERE user_id = 1 ORDER BY date DESC LIMIT 30',
    (err, rows) => {
      if (err) {
        console.error('Error fetching weight entries:', err);
        return res.status(500).json({ error: err.message });
      }
      console.log(`Fetched ${rows.length} weight entries`);
      res.json(rows);
    }
  );
});

// Add or update weight entry
app.post('/api/weight', (req, res) => {
  const { weight_kg, date } = req.body;
  
  if (!weight_kg || weight_kg <= 0) {
    return res.status(400).json({ error: 'Valid weight is required' });
  }
  
  const weightDate = validateAndGetDate(date);
  console.log(`Adding/updating weight entry: ${weight_kg}kg (${kgToLbs(weight_kg).toFixed(1)} lbs) for ${weightDate}`);
  
  // Use INSERT OR REPLACE to handle updates for the same date
  db.run(
    'INSERT OR REPLACE INTO weight_entries (user_id, weight_kg, date) VALUES (?, ?, ?)',
    [1, weight_kg, weightDate],
    function(err) {
      if (err) {
        console.error('Error saving weight entry:', err);
        return res.status(500).json({ error: err.message });
      }
      
      db.get(
        'SELECT * FROM weight_entries WHERE user_id = 1 AND date = ?',
        [weightDate],
        (err, row) => {
          if (err) {
            console.error('Error fetching saved weight entry:', err);
            return res.status(500).json({ error: err.message });
          }
          console.log(`Weight entry saved: ${weight_kg}kg (${kgToLbs(weight_kg).toFixed(1)} lbs) for ${weightDate}`);
          res.status(201).json(row);
        }
      );
    }
  );
});

// Delete weight entry
app.delete('/api/weight/:id', (req, res) => {
  db.run(
    'DELETE FROM weight_entries WHERE id = ? AND user_id = 1',
    [req.params.id],
    function(err) {
      if (err) {
        console.error('Error deleting weight entry:', err);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Weight entry not found' });
      }
      console.log(`Deleted weight entry with ID: ${req.params.id}`);
      res.json({ message: 'Weight entry deleted successfully' });
    }
  );
});

// Get today's data with intelligent goal adjustment
app.get('/api/today', (req, res) => {
  // Get date from client or use server date as fallback
  const today = validateAndGetDate(req.query.date);
  console.log(`Getting today's data for date: ${today}`);
  
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
        
        console.log(`RESULT - Date: ${today}, Foods: ${(foods || []).length}, Activities: ${(activities || []).length}, Calories burned: ${totalCaloriesBurned}`);
        console.log('Foods found:', foods ? foods.map(f => `${f.description} (${f.date})`) : 'none');
        console.log('Activities found:', activities ? activities.map(a => `${a.name} (${a.date})`) : 'none');
        
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
          totalCaloriesBurned,
          date: today
        });
      });
    });
  });
});

// Add food
app.post('/api/foods', (req, res) => {
  const { description, calories, protein, carbs, fat, date } = req.body;
  
  if (!description || !calories || calories <= 0) {
    return res.status(400).json({ error: 'Description and valid calories are required' });
  }
  
  // Use client-provided date or server date as fallback
  const foodDate = validateAndGetDate(date);
  console.log(`Adding food "${description}" for date: ${foodDate}`);
  
  db.run(
    'INSERT INTO foods (user_id, description, calories, protein, carbs, fat, date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1, description, calories, protein || 0, carbs || 0, fat || 0, foodDate],
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
        console.log(`SUCCESS: Added food "${description}" (${calories} cal) for ${foodDate} with ID: ${this.lastID}`);
        res.status(201).json(row);
      });
    }
  );
});

// Add activity
app.post('/api/activities', (req, res) => {
  const { name, duration, calories_burned, date } = req.body;
  
  if (!name || !duration || !calories_burned || duration <= 0 || calories_burned <= 0) {
    return res.status(400).json({ error: 'Name, valid duration, and calories burned are required' });
  }
  
  // Use client-provided date or server date as fallback
  const activityDate = validateAndGetDate(date);
  console.log(`Adding activity "${name}" for date: ${activityDate}`);
  
  db.run(
    'INSERT INTO activities (user_id, name, duration, calories_burned, date) VALUES (?, ?, ?, ?, ?)',
    [1, name, duration, calories_burned, activityDate],
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
        console.log(`SUCCESS: Added activity "${name}" (${calories_burned} cal burned) for ${activityDate} with ID: ${this.lastID}`);
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
          
          // Also get weight history for the same period
          db.all(
            `SELECT date, weight_kg FROM weight_entries WHERE user_id = 1 AND date >= ? ORDER BY date DESC`,
            [startDate],
            (err, weightHistory) => {
              if (err) {
                console.error('Error fetching weight history:', err);
                return res.status(500).json({ error: err.message });
              }
              
              console.log(`History: ${(foodHistory || []).length} food days, ${(activityHistory || []).length} activity days, ${(weightHistory || []).length} weight entries`);
              res.json({
                foods: foodHistory || [],
                activities: activityHistory || [],
                weights: weightHistory || []
              });
            }
          );
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