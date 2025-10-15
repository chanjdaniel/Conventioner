class Validator:
    def __init__(self, market_assignment):
        self.market_assignment = market_assignment
        self.vendors = market_assignment.vendors
        self.tables = []
        for date_assignment in market_assignment.date_assignments.values():
            for table in date_assignment.tables:
                self.tables.append(table)

    def validate_num_assignments(self):
        for vendor in self.vendors:
            if vendor.num_assignments > MAX_VENDING_DAYS:
                print(f"Invalid num assignments:\n{vendor}")

    def validate_vendor_assignments(self):
        for vendor in self.vendors:
            for date in MARKET_DATES:
                vendor_assignment = vendor.assignment[date]
                
                if vendor_assignment == None:
                    continue
                    
                vendor_tier_choices = getattr(vendor, vendor_assignment.table.date)
                if len(vendor_tier_choices) == 0:
                    print(f"Invalid date:\n{date}\n{vendor}")
                if vendor_assignment.table.tier not in vendor_tier_choices:
                    print(f"Invalid table choice:\n{vendor_assignment.table_choice}\n{vendor_tier_choices}\n{vendor}")

    def validate_tables(self):
        for table in self.tables:
            if len(table.assignment) > 2:
                print(f"Too many at table:\n{table}")

    def validate(self):
        self.validate_num_assignments()
        self.validate_vendor_assignments()
        self.validate_tables()

    def get_unassigned_vendors(self):
        result = []
        for vendor in self.vendors:
            if vendor.num_assignments == 0:
                result.append(vendor)
        return result

    def get_unassigned_vendor_table_choices(self):
        result_dict = {}
        unassigned_vendors = self.get_unassigned_vendors()
        for vendor in unassigned_vendors:
            result_dict[vendor.table_choice] = result_dict.get(vendor.table_choice, 0) + 1
        return result_dict
        
    def get_assigned_vendors(self):
        result = []
        for vendor in self.vendors:
            if vendor.num_assignments > 0:
                result.append(vendor)
        return result

    def get_vendor_assignment_counts(self):
        return_dict = {}
        for vendor in self.vendors:
            return_dict[vendor.num_assignments] = return_dict.get(vendor.num_assignments, 0) + 1
        return_dict = dict(sorted(return_dict.items()))
        return return_dict

    def get_table_assignment_counts(self):
        return_dict = {}
        for date in MARKET_DATES:
            table_choice_dict = {}
            for vendor in self.vendors:
                if vendor.assignment[date] == None:
                    continue
                table_choice = vendor.assignment[date].table_choice
                table_choice_dict[table_choice] = table_choice_dict.get(table_choice, 0) + 1
            table_choice_dict = dict(sorted(table_choice_dict.items()))
            return_dict[date] = table_choice_dict
        return return_dict

    def get_table_choice_counts(self):
        table_choice_dict = {}
        for vendor in self.vendors:
            table_choice = vendor.table_choice
            table_choice_dict[table_choice] = table_choice_dict.get(table_choice, 0) + 1
        table_choice_dict = dict(sorted(table_choice_dict.items()))
        return table_choice_dict

    def get_table_availability_counts(self):
        return_dict = {}
        for date in MARKET_DATES:
            tables_dict = {}
            for table in self.market_assignment.date_assignments[date].tables:
                tables_dict[table.availability()] = tables_dict.get(table.availability(), 0) + 1
            tables_dict = dict(sorted(tables_dict.items()))
            return_dict[date] = tables_dict
        return return_dict
        
    # for each market date, get number of tables needed if every vendor were to be assigned
    def get_theoretical_max(self):
        return_dict = {}
        
        for date in MARKET_DATES:
            for vendor in self.vendors:

                # continue if date not requested
                if len(getattr(vendor, date)) == 0:
                    continue

                increment = 1
                if vendor.table_choice == FULL_TABLE_ONLY:
                    increment = 2
                return_dict[date] = return_dict.get(date, 0) + increment

        # convert half table count to full table
        for key in return_dict.keys():
            return_dict[key] = math.ceil(return_dict[key] / 2)
            
        return return_dict