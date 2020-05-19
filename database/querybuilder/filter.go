package querybuilder

import (
	"fmt"
	"reflect"
	"strconv"
)

// FilterQuery takes a base query (something like "SELECT * FROM resumes") and adds WHERE conditions based on the filters
// The model must be a struct with "db" tags for each field that can be filtered
// The filters must map a key matching the "db" tag of the model to a list of filter strings (format of URL query params)
// Returns the final query string and query arguments that can be used by a NamedQuery
func FilterQuery(baseQuery string, filters map[string][]string, model interface{}) (string, map[string]interface{}, error) {
	filterStrings := make(map[string]string)
	for key, values := range filters {
		if len(values) >= 1 {
			// we only consider the first query parameter for now (we could AND or OR multiple params in the future)
			filterStrings[key] = values[0]
		}
	}

	query := baseQuery + " WHERE 1=1"
	queryArgs := make(map[string]interface{})

	modelReflection := reflect.ValueOf(model)
	if modelReflection.Kind() == reflect.Struct {
		for i := 0; i < modelReflection.NumField(); i++ {
			filterKey := modelReflection.Type().Field(i).Tag.Get("db")
			if filterString, ok := filterStrings[filterKey]; ok {
				var filterValue interface{}
				var err error

				switch modelReflection.Field(i).Interface().(type) {
				case bool:
					filterValue, err = strconv.ParseBool(filterString)
				case int, int8, int16, int32, int64:
					filterValue, err = strconv.ParseInt(filterString, 10, 64)
				case uint, uint8, uint16, uint32, uint64:
					filterValue, err = strconv.ParseUint(filterString, 10, 64)
				case float32, float64:
					filterValue, err = strconv.ParseFloat(filterString, 64)
				case string:
					filterValue = filterString
				}

				modelName := reflect.TypeOf(model).Name()
				if err != nil {
					return "", nil, fmt.Errorf("invalid type of filterValue value for field '%v' of '%v': %w", filterKey, modelName, err)
				}
				if filterValue == nil {
					return "", nil, fmt.Errorf("invalid field type for field '%v' of '%v'", filterKey, model)
				}

				// Note that the string being inserted into the SQL query (filterKey) comes directly from the provided model
				// and not from user input (filters), so this should be safe from SQL Injection
				query += fmt.Sprintf(" AND %[1]v = :%[1]v", filterKey) // e.g. " AND username = :username"
				queryArgs[filterKey] = filterValue
			}
		}

		return query, queryArgs, nil
	}
	return "", nil, fmt.Errorf("the provided model is not a struct")
}